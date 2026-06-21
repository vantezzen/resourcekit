import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { bundle } from "./bundle";
import { resource } from "./resource";
import { testStack } from "../testing/harness";

const issues = resource("issues", {
  schema: z.object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
  }),
});
const projects = resource("projects", {
  schema: z.object({
    id: z.string(),
    workspaceId: z.string(),
    name: z.string(),
  }),
});

const workspaceData = bundle(({ workspaceId }: { workspaceId: string }) => [
  issues.where({ workspaceId }),
  projects.where({ workspaceId }),
]);

function stack() {
  return testStack([issues, projects], {
    ctx: async () => ({}),
    resources: {
      issues: {
        backbone: memoryBackbone({
          seed: [
            { id: "i1", workspaceId: "w1", title: "One" },
            { id: "i2", workspaceId: "w2", title: "Two" },
          ],
        }),
        access: "public",
      },
      projects: {
        backbone: memoryBackbone({
          seed: [{ id: "p1", workspaceId: "w1", name: "Alpha" }],
        }),
        access: "public",
      },
    },
  });
}

describe("bundles & preload", () => {
  test("warms every query, so the screen's reads then answer from cache", async () => {
    const { client, network } = stack();
    const app = client();

    await app.preload(workspaceData, { workspaceId: "w1" });
    const requestsAfterPreload = network.requests;
    expect(requestsAfterPreload).toBeGreaterThan(0);

    // Both resources are local now - these reads, and narrower ones,
    // cost nothing.
    expect(
      (await app.query(issues.where({ workspaceId: "w1" }))).map((i) => i.id),
    ).toEqual(["i1"]);
    expect(await app.query(projects.where({ workspaceId: "w1" }))).toHaveLength(
      1,
    );
    expect(
      await app.query(
        issues.where({ workspaceId: "w1" }).filter((i) => i.title === "One"),
      ),
    ).toHaveLength(1);

    expect(network.requests).toBe(requestsAfterPreload);
  });

  test("a no-input bundle works", async () => {
    const everything = bundle(() => [issues.where(), projects.where()]);
    const { client } = stack();
    const app = client();

    await app.preload(everything);
    expect((await app.query(issues.where())).length).toBe(2);
  });

  test("preloaded data is available offline", async () => {
    const { client, network } = stack();
    const app = client();

    await app.preload(workspaceData, { workspaceId: "w1" });
    network.online = false;

    expect(
      (await app.query(issues.where({ workspaceId: "w1" }))).map((i) => i.id),
    ).toEqual(["i1"]);
  });

  test("rejects if a query in the bundle fails", async () => {
    const { client, network } = stack();
    const app = client();
    network.online = false; // nothing cached yet → the fetch fails

    expect(app.preload(workspaceData, { workspaceId: "w1" })).rejects.toThrow();
  });
});
