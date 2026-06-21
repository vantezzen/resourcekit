import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { many, one } from "../core/relation";
import { resource } from "../core/resource";
import { testStack, sleep } from "../testing/harness";

const projects = resource("projects", {
  schema: z.object({ id: z.string(), name: z.string() }),
});

const comments = resource("comments", {
  schema: z.object({ id: z.string(), issueId: z.string(), body: z.string() }),
});

const issues = resource("issues", {
  schema: z.object({
    id: z.string(),
    projectId: z.string(),
    title: z.string(),
  }),
  relations: {
    project: one(() => projects, "projectId"),
    comments: many(() => comments, "issueId"),
  },
});

function stack() {
  return testStack([issues, projects, comments], {
    ctx: async () => ({}),
    resources: {
      issues: {
        backbone: memoryBackbone({
          seed: [
            { id: "i1", projectId: "p1", title: "One" },
            { id: "i2", projectId: "p1", title: "Two" },
            { id: "i3", projectId: "p2", title: "Three" },
          ],
        }),
        access: "public",
      },
      projects: {
        backbone: memoryBackbone({
          seed: [
            { id: "p1", name: "Alpha" },
            { id: "p2", name: "Beta" },
          ],
        }),
        access: "public",
      },
      comments: {
        backbone: memoryBackbone({
          seed: [
            { id: "c1", issueId: "i1", body: "First!" },
            { id: "c2", issueId: "i1", body: "Second!" },
            { id: "c3", issueId: "i3", body: "Hello" },
          ],
        }),
        access: "public",
      },
    },
  });
}

describe("include", () => {
  test("one-relations join the target record", async () => {
    const { client } = stack();
    const app = client();
    const rows = await app.query(issues.where().include("project"));

    expect(rows.find((row) => row.id === "i1")?.project).toMatchObject({
      name: "Alpha",
    });
    expect(rows.find((row) => row.id === "i3")?.project).toMatchObject({
      name: "Beta",
    });
  });

  test("many-relations join arrays", async () => {
    const { client } = stack();
    const app = client();
    const rows = await app.query(issues.where().include("comments"));

    const first = rows.find((row) => row.id === "i1");
    expect(first?.comments.map((comment) => comment.body).sort()).toEqual([
      "First!",
      "Second!",
    ]);
    expect(rows.find((row) => row.id === "i2")?.comments).toEqual([]);
  });

  test("includes compose with each other and with refinements", async () => {
    const { client } = stack();
    const app = client();
    const rows = await app.query(
      issues
        .where()
        .include("project", "comments")
        .filter((row) => row.project?.name === "Alpha")
        .orderBy("title"),
    );
    expect(rows.map((row) => row.title)).toEqual(["One", "Two"]);
    expect(rows[0]?.comments).toHaveLength(2);
  });

  test("live queries keep joins fresh when related records change", async () => {
    const { client } = stack();
    const app = client();

    const live = app.watch(issues.where().include("project"));
    const unsubscribe = live.subscribe(() => {});
    await sleep(20);

    expect(
      live.getState().data.find((row) => row.id === "i1")?.project,
    ).toMatchObject({ name: "Alpha" });

    await app.mutate(projects.update("p1", { name: "Alpha (renamed)" }));
    await sleep(20);

    expect(
      live.getState().data.find((row) => row.id === "i1")?.project,
    ).toMatchObject({ name: "Alpha (renamed)" });
    unsubscribe();
  });

  test("re-refining a settled include query does not notify (no render loop)", async () => {
    const { client } = stack();
    const app = client();

    const live = app.watch(issues.where().include("project"));
    let notifications = 0;
    const unsubscribe = live.subscribe(() => notifications++);
    await sleep(20);

    // React re-renders re-apply the refinements on every pass. The
    // joined result is unchanged, so none of these may notify - the
    // original bug emitted on every recompute and span forever.
    const settled = notifications;
    for (let i = 0; i < 5; i++) {
      live.refine(issues.where().include("project").refinements);
      await sleep(5);
    }

    expect(notifications).toBe(settled);
    unsubscribe();
  });
});
