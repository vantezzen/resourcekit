import { ResourceKitError } from "../errors";
import type { ReadPlan, WireOrder } from "../plan/read-plan";
import type { Query, QueryInput, Refinements } from "./query.types";
import type {
  AnyRelationDef,
  IncludedShape,
  IncludeSpec,
} from "./relation.types";

/** A `one(id)` query: resolves to the record or `null`. */
export function singleQuery<T>(plan: ReadPlan): Query<T | null> {
  return { plan: plan as ReadPlan<T | null>, shape: "single" };
}

/** Resource context a collection query needs for `.take()` and `.include()`. */
export type QueryContext = {
  readonly identity: string;
  readonly relations: Record<string, AnyRelationDef>;
};

const NO_CONTEXT: QueryContext = { identity: "id", relations: {} };

/**
 * A `where(...)` query with chainable, immutable local refinements.
 */
export class CollectionQuery<
  T,
  TRelations extends Record<string, AnyRelationDef> = {},
> implements Query<T[]> {
  readonly shape = "many" as const;

  constructor(
    readonly plan: ReadPlan<T[]>,
    readonly refinements: Refinements<T> = { predicates: [] },
    private readonly context: QueryContext = NO_CONTEXT,
    readonly includes: readonly IncludeSpec[] = [],
  ) {}

  /** Narrow the result with any predicate - runs locally, full TypeScript. */
  filter(predicate: (record: T) => boolean): CollectionQuery<T, TRelations> {
    return this.with({
      ...this.refinements,
      predicates: [...this.refinements.predicates, predicate],
    });
  }

  /** Sort by a field or a custom comparator - runs locally. */
  orderBy(compare: (a: T, b: T) => number): CollectionQuery<T, TRelations>;
  orderBy(
    field: keyof T & string,
    direction?: "asc" | "desc",
  ): CollectionQuery<T, TRelations>;
  orderBy(
    fieldOrCompare: (keyof T & string) | ((a: T, b: T) => number),
    direction: "asc" | "desc" = "asc",
  ): CollectionQuery<T, TRelations> {
    const compare =
      typeof fieldOrCompare === "function"
        ? fieldOrCompare
        : (fieldComparator(fieldOrCompare, direction) as (
            a: T,
            b: T,
          ) => number);
    return this.with({ ...this.refinements, compare });
  }

  /** Keep only the first `n` records (applied locally, after filter and sort). */
  limit(n: number): CollectionQuery<T, TRelations> {
    return this.with({ ...this.refinements, limit: n });
  }

  /**
   * Window the *synced set itself*: only the top `n` records by `field`
   * are fetched and kept locally. Use this for large sets where syncing
   * everything is too much; use `.limit()` to trim an already-synced set.
   */
  take(
    n: number,
    field: keyof T & string = this.context.identity as keyof T & string,
    direction: "asc" | "desc" = "asc",
  ): CollectionQuery<T, TRelations> {
    if (this.plan.op !== "where") {
      throw new ResourceKitError(
        "invalid_input",
        ".take() only applies to where() queries.",
      );
    }
    return new CollectionQuery(
      { ...this.plan, limit: n, order: { field, direction } },
      this.refinements,
      this.context,
      this.includes,
    );
  }

  /**
   * Join related records in locally. The runtime syncs the related
   * records automatically and keeps the join live.
   */
  include<K extends keyof TRelations & string>(
    ...keys: K[]
  ): CollectionQuery<T & IncludedShape<TRelations, K>, TRelations> {
    const added = keys.map((key) => {
      const relation = this.context.relations[key];
      if (!relation) {
        throw new ResourceKitError(
          "invalid_input",
          `Unknown relation "${key}" on resource "${this.plan.resource}".`,
        );
      }
      return { key, relation };
    });
    return new CollectionQuery(
      this.plan as ReadPlan<(T & IncludedShape<TRelations, K>)[]>,
      this.refinements as Refinements<T & IncludedShape<TRelations, K>>,
      this.context,
      [...this.includes, ...added],
    );
  }

  private with(refinements: Refinements<T>): CollectionQuery<T, TRelations> {
    return new CollectionQuery(
      this.plan,
      refinements,
      this.context,
      this.includes,
    );
  }
}

function fieldComparator(
  field: string,
  direction: "asc" | "desc",
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  const sign = direction === "desc" ? -1 : 1;
  return (a, b) => {
    const left = a[field] as string | number | null | undefined;
    const right = b[field] as string | number | null | undefined;
    if (left === right) return 0;
    if (left === null || left === undefined) return sign;
    if (right === null || right === undefined) return -sign;
    return (left < right ? -1 : 1) * sign;
  };
}

/** Comparator for a wire-level `order` (shared by caches and adapters). */
export function wireOrderComparator(
  order: WireOrder,
): (a: Record<string, unknown>, b: Record<string, unknown>) => number {
  return fieldComparator(order.field, order.direction);
}

/** Apply a query's local refinements to a synced set. */
export function applyRefinements<T>(
  records: readonly T[],
  refinements: Refinements<T> | undefined,
): T[] {
  if (!refinements) return [...records];
  let result = records.filter((record) =>
    refinements.predicates.every((predicate) => predicate(record)),
  );
  if (refinements.compare) result = result.sort(refinements.compare);
  if (refinements.limit !== undefined)
    result = result.slice(0, refinements.limit);
  return result;
}

/** Accept either a `Query` or a bare read plan anywhere reads are taken. */
export function toQuery<TResult>(input: QueryInput<TResult>): Query<TResult> {
  if ("plan" in input) return input;
  return { plan: input, shape: input.op === "one" ? "single" : "many" };
}
