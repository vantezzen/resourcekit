import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { TransportError } from "../errors";
import type { SyncResponse } from "../sync/protocol";
import type { Transport } from "../sync/transport";
import { engine } from "./engine";
import { resource } from "./resource";

const issues = resource("issues", {
  schema: z.object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    score: z.number(),
  }),
});
type Issue = z.infer<(typeof issues)["schema"]>;

const seed: Issue[] = [
  { id: "a", workspaceId: "w1", title: "Alpha", score: 10 },
  { id: "b", workspaceId: "w1", title: "Beta", score: 90 },
];

/** A transport that answers `where` reads from a fixed set. */
function makeHarness() {
  const network = { online: true, requests: 0 };
  const transport: Transport = async (message) => {
    network.requests += 1;
    if (!network.online) throw new TransportError("Simulated offline.");
    return {
      ok: true,
      results: message.plans.map((plan) => {
        if (plan.type === "read" && plan.op === "where") {
          return { ok: true as const, data: seed };
        }
        const row = seed.find((r) => "id" in plan && r.id === plan.id) ?? null;
        const data =
          row && plan.type === "write" && plan.op === "patch"
            ? { ...row, ...plan.patch }
            : row;
        return { ok: true as const, data };
      }),
    } satisfies SyncResponse;
  };
  return { app: engine({ resources: [issues], transport }), network };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("LiveQuery", () => {
  test("loading → fresh, with data, coverage, and one network round trip", async () => {
    const { app, network } = makeHarness();
    const live = app.watch(issues.where({ workspaceId: "w1" }));

    const states: string[] = [];
    const unsubscribe = live.subscribe(() =>
      states.push(live.getState().status),
    );

    expect(live.getState().status).toBe("loading");
    await settle();

    const state = live.getState();
    expect(state.status).toBe("fresh");
    expect(state.coverage).toBe("complete");
    expect(state.data.map((issue) => issue.id).sort()).toEqual(["a", "b"]);
    expect(network.requests).toBe(1);
    unsubscribe();
  });

  test("queries sharing a sync key share one channel (single request)", async () => {
    const { app, network } = makeHarness();
    const first = app.watch(issues.where({ workspaceId: "w1" }));
    const second = app.watch(
      issues.where({ workspaceId: "w1" }).filter((issue) => issue.score > 50),
    );

    const unsubs = [first.subscribe(() => {}), second.subscribe(() => {})];
    await settle();

    expect(network.requests).toBe(1);
    expect(first.getState().data).toHaveLength(2);
    expect(second.getState().data.map((issue) => issue.id)).toEqual(["b"]);
    unsubs.forEach((unsub) => unsub());
  });

  test("refinements re-apply without refetching", async () => {
    const { app, network } = makeHarness();
    const live = app.watch(issues.where({ workspaceId: "w1" }));
    const unsubscribe = live.subscribe(() => {});
    await settle();

    live.refine({
      predicates: [(issue: Issue) => issue.title.startsWith("B")],
    });
    await settle();

    expect(live.getState().data.map((issue) => issue.id)).toEqual(["b"]);
    expect(network.requests).toBe(1);
    unsubscribe();
  });

  test("mutations notify live queries instantly (optimistic)", async () => {
    const { app } = makeHarness();
    const live = app.watch(issues.where({ workspaceId: "w1" }));
    const unsubscribe = live.subscribe(() => {});
    await settle();

    void app.mutate(issues.update("a", { title: "Edited" }));
    await settle();

    const alpha = live.getState().data.find((issue) => issue.id === "a");
    expect(alpha?.title).toBe("Edited");
    unsubscribe();
  });

  test("offline status with cached data still showing", async () => {
    const { app, network } = makeHarness();

    // Warm the cache, then drop the network and watch with staleness.
    await app.query(issues.where({ workspaceId: "w1" }));
    network.online = false;

    const live = app.watch(issues.where({ workspaceId: "w1" }));
    const unsubscribe = live.subscribe(() => {});
    await settle();

    const state = live.getState();
    expect(state.status).toBe("offline");
    expect(state.data).toHaveLength(2);
    unsubscribe();
  });

  test("local-only engines report fresh from the cache", async () => {
    const todos = resource("todos", {
      schema: z.object({ id: z.string(), text: z.string() }),
    });
    const app = engine({ resources: [todos], source: null });
    await app.mutate(todos.create({ id: "t1", text: "hi" }));

    const live = app.watch(todos.where());
    const unsubscribe = live.subscribe(() => {});
    await settle();

    expect(live.getState().status).toBe("fresh");
    expect(live.getState().data).toHaveLength(1);
    unsubscribe();
  });
});
