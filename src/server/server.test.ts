import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { action } from "../core/action";
import { engine } from "../core/engine";
import { resource } from "../core/resource";
import { AccessDeniedError, NotFoundError, ResourceKitError } from "../errors";
import { server } from "./index";

const IssueSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  score: z.number(),
  assigneeId: z.string().nullable(),
});

const issues = resource("issues", {
  schema: IssueSchema,
  actions: {
    assign: action(z.object({ userId: z.string() }), ({ input }) => ({
      assigneeId: input.userId,
    })),
    charge: action(z.object({ amount: z.number() }), null),
  },
});

type Ctx = { workspaceIds: string[] };

const seed = [
  { id: "a", workspaceId: "w1", title: "Alpha", score: 10, assigneeId: null },
  { id: "b", workspaceId: "w2", title: "Beta", score: 20, assigneeId: null },
];

function makeServer(charge = async (_args: unknown) => ({ charged: true })) {
  const app = engine({ resources: [issues], source: null });
  return server(app, {
    ctx: async (): Promise<Ctx> => ({ workspaceIds: ["w1"] }),
    resources: {
      issues: {
        backbone: memoryBackbone({ seed: seed.map((row) => ({ ...row })) }),
        access: (ctx) => ({ workspaceId: { in: ctx.workspaceIds } }),
        actions: { charge },
      },
    },
  });
}

const ctx: Ctx = { workspaceIds: ["w1"] };

describe("access scopes", () => {
  test("scope is AND-ed into where reads", async () => {
    const session = makeServer().session(ctx);
    const all = await session.query(issues.where());
    expect(all.map((issue) => issue.id)).toEqual(["a"]);

    const outside = await session.query(issues.where({ workspaceId: "w2" }));
    expect(outside).toEqual([]);
  });

  test("one reads outside scope answer null", async () => {
    const session = makeServer().session(ctx);
    expect(await session.query(issues.one("a"))).toMatchObject({ id: "a" });
    expect(await session.query(issues.one("b"))).toBeNull();
  });

  test("writes outside scope are denied", async () => {
    const session = makeServer().session(ctx);
    expect(
      session.mutate(issues.update("b", { title: "Hijack" })),
    ).rejects.toBeInstanceOf(AccessDeniedError);
    expect(session.mutate(issues.delete("b"))).rejects.toBeInstanceOf(
      AccessDeniedError,
    );
  });

  test("a patch cannot move a record out of scope", async () => {
    const session = makeServer().session(ctx);
    expect(
      session.mutate(issues.update("a", { workspaceId: "w2" })),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });

  test("creates outside scope are denied; in-scope creates land", async () => {
    const session = makeServer().session(ctx);
    expect(
      session.mutate(
        issues.create({
          id: "c",
          workspaceId: "w2",
          title: "C",
          score: 0,
          assigneeId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(AccessDeniedError);

    const created = await session.mutate(
      issues.create({
        id: "d",
        workspaceId: "w1",
        title: "D",
        score: 0,
        assigneeId: null,
      }),
    );
    expect(created).toMatchObject({ id: "d" });
  });

  test("a missing access rule denies everything by default", async () => {
    const app = engine({ resources: [issues], source: null });
    const denyingServer = server(app, {
      ctx: async () => ({}),
      resources: {
        issues: {
          backbone: memoryBackbone({ seed }),
          access: undefined as never,
          actions: { charge: async () => null },
        },
      },
    });
    expect(
      denyingServer.session({}).query(issues.where()),
    ).rejects.toBeInstanceOf(AccessDeniedError);
  });
});

describe("actions", () => {
  test("declarative actions lower against the canonical record", async () => {
    const session = makeServer().session(ctx);
    const result = await session.mutate(
      issues.actions.assign("a", { userId: "u9" }),
    );
    expect(result).toMatchObject({ id: "a", assigneeId: "u9" });
  });

  test("actions on missing records 404", async () => {
    const session = makeServer().session(ctx);
    expect(
      session.mutate(issues.actions.assign("ghost", { userId: "u9" })),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("opaque actions run their server implementation with ctx", async () => {
    let seen: unknown = null;
    const session = makeServer(async (args) => {
      seen = args;
      return { charged: true };
    }).session(ctx);

    const result = await session.mutate(
      issues.actions.charge("a", { amount: 100 }),
    );
    expect(result).toEqual({ charged: true });
    expect(seen).toMatchObject({
      id: "a",
      input: { amount: 100 },
      record: { id: "a" },
      ctx: { workspaceIds: ["w1"] },
    });
  });
});

describe("sync endpoint", () => {
  const post = (body: unknown) =>
    makeServer().POST(
      new Request("http://test/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );

  test("executes a batch and returns per-plan results in order", async () => {
    const response = await post({
      schemaVersion: "1",
      plans: [
        issues.where({ workspaceId: "w1" }).plan,
        issues.update("a", { title: "Renamed" }),
        issues.one("b").plan,
        issues.update("b", { title: "Denied" }),
      ],
    });
    const body = (await response.json()) as {
      ok: true;
      results: Array<{ ok: boolean; data?: unknown; error?: { code: string } }>;
    };

    expect(body.results[0]?.ok).toBe(true);
    expect(body.results[1]).toMatchObject({
      ok: true,
      data: { title: "Renamed" },
    });
    expect(body.results[2]).toEqual({ ok: true, data: null });
    expect(body.results[3]).toMatchObject({
      ok: false,
      error: { code: "access_denied" },
    });
  });

  test("rejects malformed envelopes", async () => {
    expect((await post({ nope: true })).status).toBe(400);
  });

  test("validates client records against the resource schema", async () => {
    const response = await post({
      schemaVersion: "1",
      plans: [
        {
          type: "write",
          resource: "issues",
          op: "create",
          record: { id: "x", title: 42 },
        },
      ],
    });
    const body = (await response.json()) as {
      results: Array<{ ok: boolean; error?: { code: string } }>;
    };
    expect(body.results[0]).toMatchObject({
      ok: false,
      error: { code: "invalid_input" },
    });
  });
});

describe("server session reads with refinements", () => {
  test("refinements run server-side too (same code as RSC)", async () => {
    const session = makeServer().session(ctx);
    const top = await session.query(
      issues
        .where({ workspaceId: "w1" })
        .filter((issue) => issue.score >= 10)
        .limit(1),
    );
    expect(top).toHaveLength(1);
  });
});
