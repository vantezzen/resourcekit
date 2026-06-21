import type { ReadPlan } from "../plan/read-plan";
import type { IncludeSpec } from "./relation.types";

/**
 * A query pairs a serializable plan (which set of records to sync) with
 * local refinements - plain TypeScript predicates, sorting, and limits
 * that run against the cache and never cross the wire.
 */

export type Refinements<T> = {
  readonly predicates: ReadonlyArray<(record: T) => boolean>;
  readonly compare?: (a: T, b: T) => number;
  readonly limit?: number;
};

export type Query<TResult> = {
  readonly plan: ReadPlan<TResult>;
  /** Whether the result is a single record (`one`) or a list (`where`). */
  readonly shape: "single" | "many";
  readonly refinements?: Refinements<any>;
  /** Relations to join in locally (synced automatically). */
  readonly includes?: readonly IncludeSpec[];
};

/** What every read API accepts: a query or a bare plan. */
export type QueryInput<TResult> = Query<TResult> | ReadPlan<TResult>;
