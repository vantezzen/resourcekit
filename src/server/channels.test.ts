import { describe, expect, test } from "bun:test";
import type { LiveChange } from "../sync/live.types";
import { ChangeFeed } from "./change-feed";
import type { ChangeChannel } from "./channel.types";
import { redisChannel } from "./channels";

/** A fake pub/sub bus: every connected channel sees every message (like Redis). */
function makeBus() {
  const subscribers = new Set<(message: string) => void>();
  return {
    connect: (): ChangeChannel => ({
      publish: (message) => {
        for (const subscriber of subscribers) subscriber(message);
      },
      subscribe: (onMessage) => {
        subscribers.add(onMessage);
        return () => subscribers.delete(onMessage);
      },
    }),
  };
}

describe("ChangeFeed.syncVia", () => {
  test("relays changes from one instance to another", () => {
    const bus = makeBus();
    const instanceA = new ChangeFeed();
    const instanceB = new ChangeFeed();
    instanceA.syncVia(bus.connect());
    instanceB.syncVia(bus.connect());

    const onA: LiveChange[] = [];
    const onB: LiveChange[] = [];
    instanceA.subscribe((c) => onA.push(c));
    instanceB.subscribe((c) => onB.push(c));

    // A write lands on instance A.
    instanceA.emit({ resource: "issues" });

    // A's own clients saw it once (no echo); B's clients got it relayed.
    expect(onA).toEqual([{ resource: "issues" }]);
    expect(onB).toEqual([{ resource: "issues" }]);
  });

  test("ignores the echo of its own published change (no loop)", () => {
    const bus = makeBus();
    const feed = new ChangeFeed();
    feed.syncVia(bus.connect());

    const seen: LiveChange[] = [];
    feed.subscribe((c) => seen.push(c));

    feed.emit({ resource: "issues" });
    // Exactly one local notification - the bus echo is filtered by origin.
    expect(seen).toEqual([{ resource: "issues" }]);
  });

  test("stop() detaches from the channel", () => {
    const bus = makeBus();
    const a = new ChangeFeed();
    const b = new ChangeFeed();
    a.syncVia(bus.connect());
    const stop = b.syncVia(bus.connect());

    const onB: LiveChange[] = [];
    b.subscribe((c) => onB.push(c));

    stop();
    a.emit({ resource: "issues" });
    expect(onB).toEqual([]); // B no longer relays
  });
});

describe("redisChannel", () => {
  test("works with an ioredis-style client (subscribe + on('message'))", () => {
    const published: Array<[string, string]> = [];
    let messageHandler: ((channel: string, message: string) => void) | null =
      null;
    const subscribed: string[] = [];

    const ch = redisChannel({
      publisher: { publish: (c, m) => published.push([c, m]) },
      subscriber: {
        subscribe: (c) => subscribed.push(c),
        on: (_event, handler) => (messageHandler = handler),
      },
    });

    const received: string[] = [];
    ch.subscribe((m) => received.push(m));
    ch.publish("hello");

    expect(published).toEqual([["resourcekit:changes", "hello"]]);
    expect(subscribed).toEqual(["resourcekit:changes"]);

    // Only messages on our channel are delivered.
    messageHandler!("resourcekit:changes", "a");
    messageHandler!("some:other:channel", "b");
    expect(received).toEqual(["a"]);
  });

  test("accepts a single client and duplicates it for the subscriber", () => {
    const published: Array<[string, string]> = [];
    let messageHandler: ((channel: string, message: string) => void) | null =
      null;
    const subscriberConnection = {
      publish: () => {},
      subscribe: () => {},
      on: (_event: "message", h: (c: string, m: string) => void) => {
        messageHandler = h;
      },
    };
    const client = {
      publish: (c: string, m: string) => published.push([c, m]),
      subscribe: () => {},
      on: () => {},
      duplicate: () => subscriberConnection,
    };

    const ch = redisChannel(client);
    const received: string[] = [];
    ch.subscribe((m) => received.push(m));

    ch.publish("hi");
    expect(published).toEqual([["resourcekit:changes", "hi"]]);

    messageHandler!("resourcekit:changes", "relayed");
    expect(received).toEqual(["relayed"]);
  });

  test("works with a node-redis-style client (subscribe(channel, listener))", () => {
    let listener: ((message: string) => void) | null = null;
    const ch = redisChannel({
      channel: "custom",
      publisher: { publish: () => {} },
      subscriber: {
        subscribe: (_c, l) => {
          listener = l ?? null;
        },
      },
    });

    const received: string[] = [];
    ch.subscribe((m) => received.push(m));
    listener!("x");
    expect(received).toEqual(["x"]);
  });

  test("bridges two feeds end to end through Redis-style clients", () => {
    // One shared "message bus" both fake subscribers listen on.
    const handlers = new Set<(channel: string, message: string) => void>();
    const makeClients = () => ({
      publisher: {
        publish: (c: string, m: string) => {
          for (const h of handlers) h(c, m);
        },
      },
      subscriber: {
        subscribe: () => {},
        on: (_e: "message", h: (channel: string, message: string) => void) =>
          handlers.add(h),
      },
    });

    const a = new ChangeFeed();
    const b = new ChangeFeed();
    a.syncVia(redisChannel(makeClients()));
    b.syncVia(redisChannel(makeClients()));

    const onB: LiveChange[] = [];
    b.subscribe((c) => onB.push(c));
    a.emit({ resource: "projects" });

    expect(onB).toEqual([{ resource: "projects" }]);
  });
});
