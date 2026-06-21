import { RedisClient } from "bun";
import type { RedisLikeClient } from "resourcekit/redis";

const url = process.env.REDIS_URL ?? "redis://localhost:6380";
const redis = new RedisClient(url);

/**
 * A thin `RedisLikeClient` over Bun's built-in Redis client - exactly
 * the four commands the Redis backbone needs (the adapter does its
 * filtering in JS over a key scan).
 */
export const redisClient: RedisLikeClient = {
  get: (key) => redis.get(key),
  set: (key, value) => redis.set(key, value),
  del: (key) => redis.del(key),
  keys: (pattern) => redis.send("KEYS", [pattern]) as Promise<string[]>,
};
