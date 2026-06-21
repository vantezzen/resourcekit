import { describe, test } from "bun:test";
import { sourceBackboneContract } from "../testing/contract";
import { redisBackbone, type RedisLikeClient } from "./redis";

/**
 * An in-memory Redis stand-in. The adapter does all filtering in JS over
 * a key scan, so this Map exercises the exact same code path a real
 * server would - only GET/SET/DEL/KEYS differ, and a Map mirrors those
 * faithfully.
 */
function fakeRedis(): RedisLikeClient {
  const store = new Map<string, string>();
  return {
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => void store.set(key, value),
    del: async (key) => void store.delete(key),
    keys: async (pattern) => {
      const prefix = pattern.replace(/\*$/, "");
      return [...store.keys()].filter((key) => key.startsWith(prefix));
    },
  };
}

describe("redis backbone fulfills the source contract", () => {
  for (const contractCase of sourceBackboneContract(async () => ({
    backbone: redisBackbone(fakeRedis()),
  }))) {
    test(contractCase.name, contractCase.run);
  }
});
