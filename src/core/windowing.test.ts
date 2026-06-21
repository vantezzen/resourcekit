import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { resource } from "../core/resource";
import { testStack } from "../testing/harness";

const tasks = resource("tasks", {
  schema: z.object({ id: z.string(), group: z.string(), score: z.number() }),
});

const seed = [1, 2, 3, 4, 5].map((n) => ({
  id: `t${n}`,
  group: n <= 2 ? "small" : "big",
  score: n * 10,
}));

function stack(maxRows?: number) {
  return testStack([tasks], {
    ctx: async () => ({}),
    maxRows,
    resources: {
      tasks: {
        backbone: memoryBackbone({ seed: seed.map((row) => ({ ...row })) }),
        access: "public",
      },
    },
  });
}

describe("windowed sync (.take)", () => {
  test("syncs only the top n by the given order", async () => {
    const { client, network } = stack();
    const app = client();

    const top = await app.query(tasks.where().take(2, "score", "desc"));
    expect(top.map((task) => task.id)).toEqual(["t5", "t4"]);
    expect(network.requests).toBe(1);
  });

  test("a windowed set is never reported as complete", async () => {
    const { client } = stack();
    const app = client();
    const query = tasks.where().take(2, "score", "desc");

    await app.query(query);
    const live = app.watch(query);
    const unsubscribe = live.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(live.getState().coverage).toBe("partial");
    unsubscribe();
  });

  test("local refinements still apply within the window", async () => {
    const { client } = stack();
    const app = client();
    const top = await app.query(
      tasks
        .where()
        .take(3, "score", "desc")
        .filter((task) => task.score > 35),
    );
    expect(top.map((task) => task.id)).toEqual(["t5", "t4"]);
  });
});

describe("server row cap", () => {
  test("oversized unwindowed reads fail loudly instead of truncating", async () => {
    const { client } = stack(3);
    const app = client();
    expect(app.query(tasks.where())).rejects.toMatchObject({
      code: "result_limit",
    });
  });

  test("narrower filters and windows stay under the cap", async () => {
    const { client } = stack(3);
    const app = client();
    expect(await app.query(tasks.where({ group: "small" }))).toHaveLength(2);
    expect(await app.query(tasks.where().take(3))).toHaveLength(3);
  });

  test("a window larger than the cap is rejected as input", async () => {
    const { client } = stack(3);
    const app = client();
    expect(app.query(tasks.where().take(10))).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
