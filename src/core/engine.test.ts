import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { TransportError } from "../errors";
import type { SyncMessage, SyncResponse } from "../sync/protocol";
import type { Transport } from "../sync/transport";
import { server, type ResourceServer } from "../server";
import { sleep } from "../testing/harness";
import { action } from "./action";
import { engine, type Engine } from "./engine";
import { resource } from "./resource";

/**
 * End-to-end: a client engine talking to a real ResourceServer through
 * an in-process transport, with a toggleable network. This is the full
 * optimistic loop the library exists for.
 */

const IssueSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  score: z.number(),
  assigneeId: z.string().nullable(),
});
type Issue = z.infer<typeof IssueSchema>;

const issues = resource("issues", {
  schema: IssueSchema,
  actions: {
    assign: action(z.object({ userId: z.string() }), ({ input }) => ({
      assigneeId: input.userId,
    })),
  },
});

const seed: Issue[] = [
  { id: "a", workspaceId: "w1", title: "Alpha", score: 10, assigneeId: null },
  { id: "b", workspaceId: "w1", title: "Beta", score: 90, assigneeId: null },
  { id: "c", workspaceId: "w2", title: "Gamma", score: 50, assigneeId: null },
];

type Harness = {
  app: Engine<readonly [typeof issues]>;
  network: { online: boolean; requests: number };
};

function harness(): Harness {
  const serverApp = engine({ resources: [issues], source: null });
  const syncServer: ResourceServer<readonly [typeof issues], {}> = server(
    serverApp,
    {
      ctx: async () => ({}),
      resources: {
        issues: {
          backbone: memoryBackbone({ seed: seed.map((row) => ({ ...row })) }),
          access: "public",
        },
      },
    },
  );

  const network = { online: true, requests: 0 };
  const transport: Transport = async (message: SyncMessage) => {
    network.requests += 1;
    if (!network.online) throw new TransportError("Simulated offline.");
    const response = await syncServer.POST(
      new Request("http://test/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      }),
    );
    return (await response.json()) as SyncResponse;
  };

  return { app: engine({ resources: [issues], transport }), network };
}

describe("one-shot query", () => {
  test("fetches from the source, then answers from coverage without the network", async () => {
    const { app, network } = harness();

    const first = await app.query(issues.where({ workspaceId: "w1" }));
    expect(first.map((issue) => issue.id).sort()).toEqual(["a", "b"]);
    expect(network.requests).toBe(1);

    // Narrower query - proven complete by coverage, no request.
    const narrower = await app.query(
      issues.where({ workspaceId: "w1", score: { gt: 50 } }),
    );
    expect(narrower.map((issue) => issue.id)).toEqual(["b"]);
    expect(network.requests).toBe(1);
  });

  test("refinements run locally on the synced set", async () => {
    const { app } = harness();
    const top = await app.query(
      issues
        .where({ workspaceId: "w1" })
        .filter((issue) => issue.title.includes("e"))
        .orderBy("score", "desc")
        .limit(1),
    );
    expect(top.map((issue) => issue.id)).toEqual(["b"]);
  });

  test("falls back to partial local data when offline", async () => {
    const { app, network } = harness();
    await app.query(issues.where({ workspaceId: "w1" }));

    network.online = false;
    const offline = await app.query(issues.where({ score: { gt: 0 } }));
    expect(offline.length).toBe(2); // only w1 is local, and that's stated:
    expect(offline.every((issue) => issue.workspaceId === "w1")).toBe(true);
  });
});

describe("optimistic writes", () => {
  test("update: canonical result confirms the optimistic patch", async () => {
    const { app } = harness();
    const canonical = await app.mutate(
      issues.update("a", { title: "Renamed" }),
    );
    expect(canonical).toMatchObject({ id: "a", title: "Renamed" });
    expect(await app.query(issues.one("a"))).toMatchObject({
      title: "Renamed",
    });
  });

  test("action: lowered on both sides, canonical wins", async () => {
    const { app } = harness();
    const canonical = await app.mutate(
      issues.actions.assign("a", { userId: "u1" }),
    );
    expect(canonical).toMatchObject({ assigneeId: "u1" });
  });

  test("rejected mutations revert the optimistic state", async () => {
    const { app } = harness();
    await app.query(issues.where({ workspaceId: "w2" }));

    // A raw out-of-schema plan (bypassing client validation, like a
    // stale or buggy client would): the server rejects it.
    const bad = app.mutate({
      type: "write",
      resource: "issues",
      op: "patch",
      id: "c",
      patch: { score: "not-a-number" },
    });
    expect(bad).rejects.toThrow();

    await bad.catch(() => {});
    const after = await app.query(issues.one("c"));
    expect(after).toMatchObject({ score: 50 });
  });
});

describe("offline replay", () => {
  test("writes queue while offline, stay visible, and land in order on reconnect", async () => {
    const { app, network } = harness();
    await app.query(issues.where({ workspaceId: "w1" }));

    network.online = false;
    const queued = [
      app.mutate(issues.update("a", { title: "Offline edit" })),
      app.mutate(issues.actions.assign("a", { userId: "u1" })),
    ];
    queued.forEach((promise) => promise.catch(() => {}));

    // Give the failed sends a beat to enter the replay queue.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(app.queuedWrites).toBe(2);

    // Optimistic state is fully visible while offline.
    const local = await app.query(issues.one("a"));
    expect(local).toMatchObject({ title: "Offline edit", assigneeId: "u1" });

    network.online = true;
    const requestsBefore = network.requests;
    await app.flushWrites();

    // The whole replay queue travels as one batched request.
    expect(network.requests).toBe(requestsBefore + 1);
    expect(app.queuedWrites).toBe(0);

    const results = await Promise.all(queued);
    expect(results[1]).toMatchObject({
      title: "Offline edit",
      assigneeId: "u1",
    });
  });

  test("a rejected write in a replayed batch doesn't block the others", async () => {
    const { app, network } = harness();
    await app.query(issues.where({ workspaceId: "w1" }));

    network.online = false;
    const good = app.mutate(issues.update("a", { title: "Good edit" }));
    const bad = app.mutate({
      type: "write",
      resource: "issues",
      op: "patch",
      id: "b",
      patch: { score: "not-a-number" },
    });
    bad.catch(() => {});

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(app.queuedWrites).toBe(2);

    network.online = true;
    await app.flushWrites();
    expect(app.queuedWrites).toBe(0);

    expect(await good).toMatchObject({ title: "Good edit" });
    expect(bad).rejects.toThrow();
    // The rejected write's optimistic state reverted.
    expect(await app.query(issues.one("b"))).toMatchObject({ score: 90 });
  });
});

describe("patches never rewrite record identity", () => {
  // A schema like the playground's: defaulted id/version/createdAt so
  // `create()` call sites can omit them. A patch must not let those
  // defaults leak back in - that used to mint a fresh id on every edit,
  // and an offline create-then-move surfaced it as a duplicate card.
  const TaskSchema = z.object({
    id: z.string().default(() => crypto.randomUUID()),
    workspaceId: z.string(),
    title: z.string(),
    status: z.enum(["todo", "in_progress", "done"]).default("todo"),
    version: z.number().default(0),
    createdAt: z.string().default(() => new Date().toISOString()),
  });
  const tasks = resource("tasks", { schema: TaskSchema, version: "version" });

  function taskApp() {
    const serverApp = engine({ resources: [tasks], source: null });
    const syncServer = server(serverApp, {
      ctx: async () => ({}),
      resources: {
        tasks: { backbone: memoryBackbone({ seed: [] }), access: "public" },
      },
    });
    const network = { online: true, requests: 0 };
    const transport: Transport = async (message: SyncMessage) => {
      network.requests += 1;
      if (!network.online) throw new TransportError("Simulated offline.");
      const response = await syncServer.POST(
        new Request("http://test/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message),
        }),
      );
      return (await response.json()) as SyncResponse;
    };
    return {
      app: engine({ resources: [tasks], transport }),
      syncServer,
      network,
    };
  }

  test("a move keeps the same id, createdAt, and bumps version", async () => {
    const { app } = taskApp();
    const created = (await app.mutate(
      tasks.create({ workspaceId: "w1", title: "My task" }),
    )) as Record<string, unknown>;

    const moved = (await app.mutate(
      tasks.update(created.id as string, { status: "in_progress" }),
    )) as Record<string, unknown>;

    expect(moved.id).toBe(created.id);
    expect(moved.createdAt).toBe(created.createdAt);
    expect(moved.status).toBe("in_progress");
    expect(moved.version).toBe(1);
  });

  test("offline create-then-move leaves one record, not a clone", async () => {
    const { app, syncServer, network } = taskApp();

    // Live updates wired in like the playground's `live` endpoint, so
    // server change events trigger refetches that race the replay.
    const stopLive = syncServer.changes.subscribe(() => {});
    void stopLive;

    const board = app.watch(tasks.where({ workspaceId: "w1" }));
    const seen: string[][] = [];
    const unsub = board.subscribe(() =>
      seen.push(
        (board.getState().data as Array<Record<string, unknown>>).map(
          (r) => `${r.id}:${r.status}`,
        ),
      ),
    );
    await sleep(10);

    network.online = false;
    const createPlan = tasks.create({ workspaceId: "w1", title: "My task" });
    const id = (createPlan as unknown as { record: { id: string } }).record.id;
    void app.mutate(createPlan).catch(() => {});
    await sleep(5);
    void app.mutate(tasks.update(id, { status: "in_progress" })).catch(() => {});
    await sleep(5);

    network.online = true;
    await app.flushWrites();
    await sleep(20);

    // No intermediate state ever showed two rows for one task.
    const everDuplicated = seen.some((rows) => {
      const ids = rows.map((r) => r.split(":")[0]);
      return new Set(ids).size !== ids.length || rows.length > 1;
    });
    expect(everDuplicated).toBe(false);

    const rows = board.getState().data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, status: "in_progress", version: 1 });

    unsub();
    app.dispose();
  });
});

describe("local-only engine", () => {
  test("works with no source at all", async () => {
    const todos = resource("todos", {
      schema: z.object({ id: z.string(), text: z.string(), done: z.boolean() }),
    });
    const app = engine({ resources: [todos], source: null });

    await app.mutate(todos.create({ id: "t1", text: "Ship it", done: false }));
    const created = await app.mutate(todos.update("t1", { done: true }));
    expect(created).toMatchObject({ id: "t1", done: true });
  });
});
