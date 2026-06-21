import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { wireOrderComparator } from "../../core/query";
import { ResourceKitError } from "../../errors";
import { matchesFilter } from "../../plan/filters";
import type { QueryPlan } from "../../plan/plan";

type Row = Record<string, unknown>;

/**
 * Minimal structural view of a Redis client - `Bun.redis` and most
 * clients expose these. The adapter never imports a Redis library; you
 * pass your own connected client.
 */
export type RedisLikeClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  /** Keys matching a glob pattern (e.g. `tasks:*`). */
  keys(pattern: string): Promise<string[]>;
};

/**
 * Source backbone backed by Redis, storing each record as a JSON string
 * under `"<resource>:<id>"`. Reads by id are direct `GET`s; `where`
 * scans the resource's keys and evaluates the filter locally (so the
 * full filter algebra works, at the cost of an O(n) scan - keep these
 * resources bounded, or front richer queries with a named query).
 */
class RedisSourceBackbone extends SourceBackbone {
  constructor(private readonly client: RedisLikeClient) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    return plan.type === "read" ? plan.op !== "named" : plan.op !== "action";
  }

  async execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown> {
    const resource = exec.resources.get(plan.resource);
    const identity = resource.identity;
    const keyOf = (id: unknown) => `${plan.resource}:${id}`;

    switch (plan.op) {
      case "one":
        return this.read(keyOf(plan.id));

      case "where": {
        const keys = await this.client.keys(`${plan.resource}:*`);
        const rows = (await Promise.all(keys.map((key) => this.read(key))))
          .filter((row): row is Row => row !== null)
          .filter((row) => matchesFilter(row, plan.filter));
        const ordered = plan.order
          ? rows.sort(wireOrderComparator(plan.order))
          : rows;
        return plan.limit !== undefined
          ? ordered.slice(0, plan.limit)
          : ordered;
      }

      case "create": {
        const record = { ...plan.record };
        await this.client.set(keyOf(record[identity]), JSON.stringify(record));
        return record;
      }

      case "patch": {
        const current = await this.read(keyOf(plan.id));
        if (!current) return null;
        const next = { ...current, ...plan.patch };
        await this.client.set(keyOf(plan.id), JSON.stringify(next));
        return next;
      }

      case "delete":
        await this.client.del(keyOf(plan.id));
        return null;

      case "named":
      case "action":
        throw new ResourceKitError(
          "internal",
          "Action and named-query plans must be resolved before reaching a source backbone.",
        );
    }
  }

  private async read(key: string): Promise<Row | null> {
    const raw = await this.client.get(key);
    return raw === null ? null : (JSON.parse(raw) as Row);
  }
}

/**
 * A Redis-backed source backbone. Records are JSON at
 * `"<resource>:<id>"`; `where` scans and filters locally.
 *
 * @example
 * ```ts
 * import { redis } from "bun";
 * redisBackbone(redis);
 * ```
 */
export function redisBackbone(client: RedisLikeClient): SourceBackbone {
  return new RedisSourceBackbone(client);
}
