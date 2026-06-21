import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { namedQuery } from "../core/named-query";
import { resource } from "../core/resource";
import { testStack } from "../testing/harness";

const StatsSchema = z.object({ total: z.number(), open: z.number() });

const issues = resource("issues", {
  schema: z.object({ id: z.string(), title: z.string(), open: z.boolean() }),
  queries: {
    search: namedQuery(
      z.object({ text: z.string() }),
      z.array(z.object({ id: z.string(), title: z.string() })),
    ),
    stats: namedQuery(z.object({}), StatsSchema),
  },
});

const seed = [
  { id: "a", title: "Fix login", open: true },
  { id: "b", title: "Fix logout", open: false },
  { id: "c", title: "Add search", open: true },
];

function stack() {
  return testStack([issues], {
    ctx: async () => ({}),
    resources: {
      issues: {
        backbone: memoryBackbone({ seed }),
        access: "public",
        queries: {
          search: async ({ input }) =>
            seed
              .filter((row) => row.title.includes(input.text))
              .map(({ id, title }) => ({ id, title })),
          stats: async () => ({
            total: seed.length,
            open: seed.filter((row) => row.open).length,
            secret: "stripped by the output schema",
          }),
        },
      },
    },
  });
}

describe("named queries", () => {
  test("array outputs are refinable collections", async () => {
    const { client } = stack();
    const app = client();
    const results = await app.query(
      issues.queries
        .search({ text: "Fix" })
        .filter((hit) => hit.title.includes("login")),
    );
    expect(results).toEqual([{ id: "a", title: "Fix login" }]);
  });

  test("object outputs resolve as single values, validated and stripped", async () => {
    const { client } = stack();
    const app = client();
    const stats = await app.query(issues.queries.stats({}));
    expect(stats).toEqual({ total: 3, open: 2 });
  });

  test("results cache as snapshots - repeats are free", async () => {
    const { client, network } = stack();
    const app = client();
    await app.query(issues.queries.search({ text: "Fix" }));
    await app.query(issues.queries.search({ text: "Fix" }));
    expect(network.requests).toBe(1);

    // A different input is a different snapshot.
    await app.query(issues.queries.search({ text: "Add" }));
    expect(network.requests).toBe(2);
  });

  test("input is validated client-side before anything ships", () => {
    expect(() =>
      issues.queries.search({ text: 42 as unknown as string }),
    ).toThrow();
  });
});
