import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { resource } from "../core/resource";
import { testStack, sleep } from "../testing/harness";
import type { LiveChange } from "./live.types";

const notes = resource("notes", {
  schema: z.object({ id: z.string(), text: z.string() }),
});

function stack() {
  return testStack([notes], {
    ctx: async () => ({}),
    resources: {
      notes: {
        backbone: memoryBackbone({ seed: [{ id: "n1", text: "hello" }] }),
        access: "public",
      },
    },
  });
}

describe("live updates", () => {
  test("the server emits a change for every accepted write", async () => {
    const { server, client } = stack();
    const changes: LiveChange[] = [];
    server.changes.subscribe((change) => changes.push(change));

    await client().mutate(notes.update("n1", { text: "edited" }));
    expect(changes).toEqual([{ resource: "notes" }]);
  });

  test("a change notification refreshes affected live queries", async () => {
    const { client } = stack();

    // Bridge the feed by hand - exactly what a custom connector does.
    let push: (change: LiveChange) => void = () => {};
    const watcher = client({
      live: (onChange) => {
        push = onChange;
        return () => {};
      },
    });
    const editor = client();

    const live = watcher.watch(notes.where());
    const unsubscribe = live.subscribe(() => {});
    await sleep(20);
    expect(live.getState().data[0]).toMatchObject({ text: "hello" });

    // Another client writes; the feed tells the watcher; it refetches.
    await editor.mutate(notes.update("n1", { text: "from elsewhere" }));
    push({ resource: "notes" });
    await sleep(20);

    expect(live.getState().data[0]).toMatchObject({ text: "from elsewhere" });
    unsubscribe();
  });

  test("the events endpoint streams changes as SSE and stops on abort", async () => {
    const { server } = stack();
    const controller = new AbortController();
    const response = server.events(
      new Request("http://test/sync/events", { signal: controller.signal }),
    );
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain("retry:");

    server.changes.emit({ resource: "notes" });
    const second = await reader.read();
    expect(decoder.decode(second.value)).toBe('data: {"resource":"notes"}\n\n');

    controller.abort();
    const done = await reader.read();
    expect(done.done).toBe(true);
  });
});
