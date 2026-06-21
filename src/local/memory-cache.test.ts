import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { action } from "../core/action";
import { ResourceRegistry, type ExecutionContext } from "../core/backbone";
import { resource } from "../core/resource";
import { MemoryCacheBackbone } from "./memory-cache";

const issues = resource("issues", {
  schema: z.object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    score: z.number(),
  }),
  actions: {
    bump: action(z.object({ by: z.number() }), ({ input, record }) => ({
      score: (record as { score: number }).score + input.by,
    })),
  },
});

const settings = resource("settings", {
  schema: z.object({ id: z.string(), theme: z.string() }),
  mode: "document",
});

const report = resource("report", {
  schema: z.object({ id: z.string(), total: z.number() }),
  mode: "snapshot",
});

const feed = resource("feed", {
  schema: z.object({ id: z.string() }),
  mode: "connection",
});

const exec: ExecutionContext = {
  resources: new ResourceRegistry([issues, settings, report, feed]),
  ctx: undefined,
};

const row = (id: string, workspaceId = "w1", score = 0) => ({
  id,
  workspaceId,
  title: `Issue ${id}`,
  score,
});

const wherePlan = (filter: Record<string, string>) =>
  issues.where(filter as { workspaceId?: string }).plan;

function seeded(rows = [row("a"), row("b", "w2")]) {
  const cache = new MemoryCacheBackbone();
  return cache.ingest(wherePlan({}), rows, exec).then(() => cache);
}

describe("mode-aware canFulfill", () => {
  const cache = new MemoryCacheBackbone();

  test("collections support reads and writes", () => {
    expect(cache.canFulfill(issues.one("a").plan, exec)).toBe(true);
    expect(cache.canFulfill(issues.where().plan, exec)).toBe(true);
    expect(cache.canFulfill(issues.update("a", { title: "x" }), exec)).toBe(
      true,
    );
  });

  test("documents support one but not where", () => {
    expect(cache.canFulfill(settings.one("s1").plan, exec)).toBe(true);
    expect(cache.canFulfill(settings.where().plan, exec)).toBe(false);
  });

  test("connection mode is never cached", () => {
    expect(cache.canFulfill(feed.one("f1").plan, exec)).toBe(false);
    expect(cache.canFulfill(feed.where().plan, exec)).toBe(false);
  });
});

describe("ingest and coverage", () => {
  test("a synced set covers itself and everything narrower", async () => {
    const cache = new MemoryCacheBackbone();
    await cache.ingest(
      wherePlan({ workspaceId: "w1" }),
      [row("a"), row("b")],
      exec,
    );

    const same = await cache.read(wherePlan({ workspaceId: "w1" }), exec);
    expect(same.coverage).toBe("complete");

    const narrower = await cache.read(
      issues.where({ workspaceId: "w1", score: { gte: 0 } }).plan,
      exec,
    );
    expect(narrower.coverage).toBe("complete");

    const other = await cache.read(wherePlan({ workspaceId: "w2" }), exec);
    expect(other.coverage).toBe("unknown");
  });

  test("ingesting a set removes records the server no longer returns", async () => {
    const cache = await seeded([row("a"), row("b")]);
    await cache.ingest(wherePlan({}), [row("a")], exec);
    const result = await cache.read(wherePlan({}), exec);
    expect((result.data as unknown[]).length).toBe(1);
  });

  test("one ingest upserts; null ingest removes", async () => {
    const cache = new MemoryCacheBackbone();
    await cache.ingest(issues.one("a").plan, row("a"), exec);
    expect((await cache.read(issues.one("a").plan, exec)).data).toEqual(
      row("a"),
    );

    await cache.ingest(issues.one("a").plan, null, exec);
    expect((await cache.read(issues.one("a").plan, exec)).data).toBeNull();
  });

  test("snapshot mode stores whole results by plan key", async () => {
    const cache = new MemoryCacheBackbone();
    const plan = report.one("usage").plan;
    expect((await cache.read(plan, exec)).coverage).toBe("unknown");
    await cache.ingest(plan, { total: 42 }, exec);
    expect(await cache.read(plan, exec)).toEqual({
      data: { total: 42 },
      coverage: "complete",
    });
  });
});

describe("optimistic overlay (snapshot + outbox)", () => {
  test("queued patch is visible immediately and reverts on rejection", async () => {
    const cache = await seeded();
    const pending = await cache.enqueue(
      issues.update("a", { title: "Edited" }),
      exec,
    );

    let read = await cache.read(issues.one("a").plan, exec);
    expect((read.data as { title: string }).title).toBe("Edited");

    await cache.settle(pending, { status: "rejected" }, exec);
    read = await cache.read(issues.one("a").plan, exec);
    expect((read.data as { title: string }).title).toBe("Issue a");
  });

  test("confirmation merges the canonical record", async () => {
    const cache = await seeded();
    const pending = await cache.enqueue(
      issues.update("a", { title: "Edited" }),
      exec,
    );
    await cache.settle(
      pending,
      {
        status: "confirmed",
        canonical: { ...row("a"), title: "Edited (server)" },
      },
      exec,
    );
    const read = await cache.read(issues.one("a").plan, exec);
    expect((read.data as { title: string }).title).toBe("Edited (server)");
  });

  test("create and delete overlay", async () => {
    const cache = await seeded();
    await cache.enqueue(issues.create(row("c")), exec);
    await cache.enqueue(issues.delete("a"), exec);

    const read = await cache.read(wherePlan({}), exec);
    const ids = (read.data as Array<{ id: string }>).map((r) => r.id).sort();
    expect(ids).toEqual(["b", "c"]);
  });

  test("declarative actions lower against the overlaid record, in order", async () => {
    const cache = await seeded([row("a", "w1", 10)]);
    await cache.enqueue(issues.actions.bump("a", { by: 5 }), exec);
    await cache.enqueue(issues.actions.bump("a", { by: 5 }), exec);

    const read = await cache.read(issues.one("a").plan, exec);
    expect((read.data as { score: number }).score).toBe(20);
  });

  test("rejecting one of several queued writes keeps the others", async () => {
    const cache = await seeded([row("a", "w1", 10)]);
    const first = await cache.enqueue(
      issues.update("a", { title: "First" }),
      exec,
    );
    await cache.enqueue(issues.actions.bump("a", { by: 1 }), exec);

    await cache.settle(first, { status: "rejected" }, exec);
    const read = await cache.read(issues.one("a").plan, exec);
    expect(read.data).toMatchObject({ title: "Issue a", score: 11 });
  });

  test("subscribers are notified on every visible change", async () => {
    const cache = await seeded();
    let notified = 0;
    cache.subscribe("issues", () => notified++);
    const pending = await cache.enqueue(
      issues.update("a", { title: "x" }),
      exec,
    );
    await cache.settle(pending, { status: "confirmed", canonical: null }, exec);
    expect(notified).toBe(2);
  });
});
