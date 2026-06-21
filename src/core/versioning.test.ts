import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { resource } from "../core/resource";
import { testStack, sleep } from "../testing/harness";

const notes = resource("notes", {
  schema: z.object({ id: z.string(), text: z.string(), version: z.number() }),
  version: "version",
});

function stack() {
  return testStack([notes], {
    ctx: async () => ({}),
    resources: {
      notes: {
        backbone: memoryBackbone({
          seed: [{ id: "n1", text: "hello", version: 0 }],
        }),
        access: "public",
      },
    },
  });
}

describe("versioning & conflicts", () => {
  test("accepted patches bump the version", async () => {
    const { client } = stack();
    const app = client();
    await app.query(notes.one("n1"));

    const first = await app.mutate(notes.update("n1", { text: "first" }));
    expect(first).toMatchObject({ text: "first", version: 1 });

    const second = await app.mutate(notes.update("n1", { text: "second" }));
    expect(second).toMatchObject({ text: "second", version: 2 });
  });

  test("a stale write conflicts, reverts, and fetches the winner", async () => {
    const { client } = stack();
    const alice = client();
    const bob = client();

    // Both clients see version 0.
    await alice.query(notes.one("n1"));
    await bob.query(notes.one("n1"));

    await alice.mutate(notes.update("n1", { text: "alice was here" }));

    const stale = bob.mutate(notes.update("n1", { text: "bob was here" }));
    expect(stale).rejects.toMatchObject({ code: "conflict" });
    await stale.catch(() => {});

    // Bob's optimistic edit reverted and the winning record arrived.
    await sleep(10);
    expect(await bob.query(notes.one("n1"))).toMatchObject({
      text: "alice was here",
      version: 1,
    });
  });

  test("chained local edits don't conflict with themselves", async () => {
    const { client } = stack();
    const app = client();
    await app.query(notes.one("n1"));

    // Fired without awaiting in between: the second write is based on
    // the first and must not carry a stale version stamp.
    const [, second] = await Promise.all([
      app.mutate(notes.update("n1", { text: "one" })),
      app.mutate(notes.update("n1", { text: "two" })),
    ]);
    expect(second).toMatchObject({ text: "two", version: 2 });
  });
});
