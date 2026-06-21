/**
 * A transport that carries change notifications between server
 * instances. It's a dumb string pub/sub - `ChangeFeed.syncVia` handles
 * the envelope (origin tagging, JSON), so a channel only has to move
 * opaque messages around.
 */
export type ChangeChannel = {
  /** Broadcast a message to every other instance (and usually back to us). */
  publish(message: string): void | Promise<void>;
  /** Receive messages from the channel; returns an unsubscribe function. */
  subscribe(onMessage: (message: string) => void): () => void;
};

/** Minimal shape of a publishing Redis client (ioredis / node-redis v4). */
export type RedisPublisher = {
  publish(channel: string, message: string): unknown;
};

/**
 * Minimal shape of a subscribing Redis client. ioredis exposes
 * `subscribe(channel)` + an `on("message", …)` emitter; node-redis v4
 * takes the listener in `subscribe(channel, listener)`. `redisChannel`
 * supports both.
 */
export type RedisSubscriber = {
  subscribe(channel: string, listener?: (message: string) => void): unknown;
  on?(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): unknown;
  off?(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): unknown;
  unsubscribe?(channel: string): unknown;
};

export type RedisChannelOptions = {
  /** A client used only to publish. */
  publisher: RedisPublisher;
  /** A *separate* client in subscriber mode (Redis can't mix the two). */
  subscriber: RedisSubscriber;
  /** The pub/sub channel name (default `"resourcekit:changes"`). */
  channel?: string;
};

/**
 * A single Redis client that can both publish and spawn a subscriber
 * connection. Pass one of these to `redisChannel(client)` and it
 * `duplicate()`s the connection for subscriber mode automatically.
 */
export type RedisClient = RedisPublisher &
  RedisSubscriber & {
    duplicate(): RedisPublisher & RedisSubscriber;
  };
