import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { resource } from "../core/resource";
import { testStack, sleep } from "../testing/harness";
import { PERSIST_DEBOUNCE_MS } from "./memory-cache";
import type { PersistedCache, StorageDriver } from "./storage.types";

const todos = resource("todos", {
  schema: z.object({ id: z.string(), text: z.string(), done: z.boolean() }),
});

/** An in-memory storage driver - what IndexedDB does, minus the browser. */
function fakeStorage(): StorageDriver & { stored: PersistedCache | null } {
  return {
    stored: null,
    async load() {
      return this.stored;
    },
    async save(state) {
      this.stored = structuredClone(state);
    },
  };
}

function stack() {
  return testStack([todos], {
    ctx: async () => ({}),
    resources: {
      todos: {
        backbone: memoryBackbone({
          seed: [{ id: "t1", text: "ship it", done: false }],
        }),
        access: "public",
      },
    },
  });
}

const settle = () => sleep(PERSIST_DEBOUNCE_MS + 30);

describe("persistence", () => {
  test("synced data and coverage survive a reload", async () => {
    const storage = fakeStorage();
    const { client, network } = stack();

    const before = client({ persist: storage });
    await before.query(todos.where());
    await settle();

    // "Reload": a fresh engine, same storage, network gone.
    network.online = false;
    const after = client({ persist: storage });
    await after.ready;
    const restored = await after.query(todos.where());

    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ text: "ship it" });
    // Coverage survived too: the cache answered without the network.
    expect(network.requests).toBe(1);
  });

  test("offline writes survive a reload and replay on reconnect", async () => {
    const storage = fakeStorage();
    const { client, network, server } = stack();

    network.online = false;
    const before = client({ persist: storage });
    const queued = before.mutate(
      todos.create({ id: "t2", text: "wrote this offline", done: false }),
    );
    queued.catch(() => {});
    await settle();
    expect(before.queuedWrites).toBe(1);

    // "Reload" with the network back: the recovered outbox replays.
    network.online = true;
    const after = client({ persist: storage });
    await after.ready;
    await after.flushWrites();

    expect(after.queuedWrites).toBe(0);
    const onServer = await server.session({}).query(todos.where({ id: "t2" }));
    expect(onServer[0]).toMatchObject({ text: "wrote this offline" });

    // And the restored optimistic record was visible locally all along.
    expect(await after.query(todos.one("t2"))).toMatchObject({
      text: "wrote this offline",
    });
  });

  test("corrupt storage starts fresh instead of crashing", async () => {
    const storage = fakeStorage();
    storage.stored = { nonsense: true } as unknown as PersistedCache;
    const { client } = stack();

    const app = client({ persist: storage });
    expect(await app.query(todos.where())).toHaveLength(1);
  });
});
