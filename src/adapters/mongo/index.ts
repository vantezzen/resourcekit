import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { ResourceKitError } from "../../errors";
import type { FieldFilter, WhereFilter } from "../../plan/filters";
import type { QueryPlan } from "../../plan/plan";

type Row = Record<string, unknown>;
type MongoQuery = Record<string, unknown>;

/**
 * Minimal structural view of a MongoDB `Collection`, so the adapter
 * never imports the `mongodb` driver - you pass your own collection and
 * the library stays dependency-free.
 */
export type MongoCursor = {
  sort(spec: Record<string, 1 | -1>): MongoCursor;
  limit(n: number): MongoCursor;
  toArray(): Promise<Row[]>;
};
export type MongoCollection = {
  findOne(
    filter: MongoQuery,
    options?: { projection?: Record<string, 0 | 1> },
  ): Promise<Row | null>;
  find(
    filter: MongoQuery,
    options?: { projection?: Record<string, 0 | 1> },
  ): MongoCursor;
  insertOne(doc: Row): Promise<unknown>;
  findOneAndUpdate(
    filter: MongoQuery,
    update: MongoQuery,
    options: {
      returnDocument: "after";
      projection?: Record<string, 0 | 1>;
    },
  ): Promise<Row | null>;
  deleteOne(filter: MongoQuery): Promise<unknown>;
};

// Mongo's internal `_id` never belongs in a resource record.
const HIDE_ID = { projection: { _id: 0 } } as const;

/**
 * Source backbone backed by a MongoDB collection. The filter algebra
 * maps directly onto Mongo query operators; the resource's identity
 * field is matched as an ordinary field (not Mongo's `_id`).
 */
class MongoSourceBackbone extends SourceBackbone {
  constructor(private readonly collection: MongoCollection) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    return plan.type === "read" ? plan.op !== "named" : plan.op !== "action";
  }

  async execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown> {
    const identity = exec.resources.get(plan.resource).identity;

    switch (plan.op) {
      case "one":
        return (
          (await this.collection.findOne({ [identity]: plan.id }, HIDE_ID)) ??
          null
        );
      case "where": {
        let cursor = this.collection.find(buildFilter(plan.filter), HIDE_ID);
        if (plan.order) {
          cursor = cursor.sort({
            [plan.order.field]: plan.order.direction === "desc" ? -1 : 1,
          });
        }
        if (plan.limit !== undefined) cursor = cursor.limit(plan.limit);
        return cursor.toArray();
      }
      case "create": {
        const record = { ...plan.record };
        await this.collection.insertOne({ ...record });
        return record;
      }
      case "patch": {
        if (Object.keys(plan.patch).length === 0) {
          return (
            (await this.collection.findOne({ [identity]: plan.id }, HIDE_ID)) ??
            null
          );
        }
        return (
          (await this.collection.findOneAndUpdate(
            { [identity]: plan.id },
            { $set: plan.patch },
            { returnDocument: "after", ...HIDE_ID },
          )) ?? null
        );
      }
      case "delete":
        await this.collection.deleteOne({ [identity]: plan.id });
        return null;
      case "named":
      case "action":
        throw new ResourceKitError(
          "internal",
          "Action and named-query plans must be resolved before reaching a source backbone.",
        );
    }
  }
}

/** Translate the filter algebra into a Mongo query document. */
function buildFilter(filter: WhereFilter): MongoQuery {
  const query: MongoQuery = {};
  for (const [field, fieldFilter] of Object.entries(filter)) {
    query[field] = fieldCondition(fieldFilter);
  }
  return query;
}

function fieldCondition(filter: FieldFilter): unknown {
  if (filter === null || typeof filter !== "object") return filter;

  const cond: Record<string, unknown> = {};
  if (filter.eq !== undefined) cond.$eq = filter.eq;
  if (filter.in !== undefined) cond.$in = filter.in;
  if (filter.gt !== undefined) cond.$gt = filter.gt;
  if (filter.gte !== undefined) cond.$gte = filter.gte;
  if (filter.lt !== undefined) cond.$lt = filter.lt;
  if (filter.lte !== undefined) cond.$lte = filter.lte;
  return cond;
}

/**
 * A MongoDB-backed source backbone for one collection. Records are
 * matched by the resource's identity field; Mongo's `_id` is hidden.
 *
 * @example
 * ```ts
 * import { MongoClient } from "mongodb";
 * const db = new MongoClient(url).db("app");
 * mongoBackbone(db.collection("tasks"));
 * ```
 */
export function mongoBackbone(collection: MongoCollection): SourceBackbone {
  return new MongoSourceBackbone(collection);
}
