import type {
  ChangeChannel,
  RedisChannelOptions,
  RedisClient,
} from "./channel.types";

export type {
  ChangeChannel,
  RedisChannelOptions,
  RedisClient,
  RedisPublisher,
  RedisSubscriber,
} from "./channel.types";

const DEFAULT_CHANNEL = "resourcekit:changes";

/**
 * Bridge the change feed through Redis pub/sub. Works with `ioredis`,
 * `node-redis`, and any managed Redis (Upstash, Redis Cloud, …).
 *
 * Pass a single client and it `duplicate()`s the connection for
 * subscriber mode (a Redis connection in subscriber mode can't also
 * publish):
 *
 * ```ts
 * import Redis from "ioredis";
 * import { redisChannel } from "resourcekit/server";
 *
 * resourceServer.changes.syncVia(redisChannel(new Redis(process.env.REDIS_URL)));
 * ```
 *
 * Or pass the two connections yourself - useful with `node-redis`,
 * where the duplicated subscriber must be `.connect()`ed before use:
 *
 * ```ts
 * resourceServer.changes.syncVia(redisChannel({ publisher, subscriber }));
 * ```
 */
export function redisChannel(client: RedisClient): ChangeChannel;
export function redisChannel(options: RedisChannelOptions): ChangeChannel;
export function redisChannel(
  input: RedisClient | RedisChannelOptions,
): ChangeChannel {
  const options: RedisChannelOptions =
    "publisher" in input
      ? input
      : { publisher: input, subscriber: input.duplicate() };
  const name = options.channel ?? DEFAULT_CHANNEL;
  const { publisher, subscriber } = options;

  return {
    publish: (message) => {
      publisher.publish(name, message);
    },
    subscribe: (onMessage) => {
      // ioredis: subscribe(channel) then listen on the "message" event.
      if (typeof subscriber.on === "function") {
        const handler = (channel: string, message: string) => {
          if (channel === name) onMessage(message);
        };
        subscriber.subscribe(name);
        subscriber.on("message", handler);
        return () => {
          subscriber.off?.("message", handler);
          subscriber.unsubscribe?.(name);
        };
      }
      // node-redis v4: subscribe(channel, listener).
      subscriber.subscribe(name, (message) => onMessage(message));
      return () => {
        subscriber.unsubscribe?.(name);
      };
    },
  };
}

/**
 * Build a channel from raw publish/subscribe functions - for any
 * transport not covered by the prebuilt helpers (a websocket hub, a
 * message queue, an HTTP store you poll yourself).
 *
 * @example
 * ```ts
 * resourceServer.changes.syncVia(
 *   channel({
 *     publish: (message) => hub.broadcast(message),
 *     subscribe: (onMessage) => hub.onMessage(onMessage), // returns unsubscribe
 *   }),
 * );
 * ```
 */
export function channel(impl: ChangeChannel): ChangeChannel {
  return impl;
}
