import { z } from "zod";

/**
 * The wire filter language: equality, membership, and ranges. A filter
 * describes which records to sync; richer predicates run locally as
 * query refinements and never cross the wire.
 *
 * One condition algebra backs local matching (`matchesFilter`),
 * coverage checks (`filterSubsumes`), and access scopes
 * (`intersectFilters`).
 */

import type { Comparable, Scalar } from "./filters.types";

export type {
  Comparable,
  FieldFilterInput,
  Scalar,
  WhereInput,
} from "./filters.types";

const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const ComparableSchema = z.union([z.string(), z.number()]);

/** Identity values as they appear in plans (`one`, `patch`, `delete`, `action`). */
export const IdSchema = z.union([z.string(), z.number()]);

export const FieldFilterSchema = z.union([
  ScalarSchema,
  z
    .object({
      eq: ScalarSchema.optional(),
      in: z.array(ScalarSchema).optional(),
      gt: ComparableSchema.optional(),
      gte: ComparableSchema.optional(),
      lt: ComparableSchema.optional(),
      lte: ComparableSchema.optional(),
    })
    .strict(),
]);
export type FieldFilter = z.infer<typeof FieldFilterSchema>;

export const WhereFilterSchema = z.record(z.string(), FieldFilterSchema);
export type WhereFilter = z.infer<typeof WhereFilterSchema>;

type Bound = { value: Comparable; exclusive: boolean };

/**
 * A field condition in canonical form. The matched set is the
 * intersection of every present part. `unsatisfiable` marks a condition
 * that no value can match (e.g. `eq: "a"` intersected with `eq: "b"`).
 */
type Condition = {
  eq?: Scalar;
  in?: Scalar[];
  lower?: Bound;
  upper?: Bound;
  unsatisfiable?: true;
};

const UNSATISFIABLE: Condition = { unsatisfiable: true };

function normalize(filter: FieldFilter): Condition {
  if (filter === null || typeof filter !== "object") {
    return { eq: filter };
  }
  const condition: Condition = {};
  if (filter.eq !== undefined) condition.eq = filter.eq;
  if (filter.in !== undefined) condition.in = [...filter.in];
  if (filter.gte !== undefined)
    condition.lower = { value: filter.gte, exclusive: false };
  if (filter.gt !== undefined)
    condition.lower = tighterLower(condition.lower, {
      value: filter.gt,
      exclusive: true,
    });
  if (filter.lte !== undefined)
    condition.upper = { value: filter.lte, exclusive: false };
  if (filter.lt !== undefined)
    condition.upper = tighterUpper(condition.upper, {
      value: filter.lt,
      exclusive: true,
    });
  return simplify(condition);
}

function tighterLower(a: Bound | undefined, b: Bound): Bound {
  if (!a) return b;
  if (a.value === b.value) return a.exclusive ? a : b;
  return a.value > b.value ? a : b;
}

function tighterUpper(a: Bound | undefined, b: Bound): Bound {
  if (!a) return b;
  if (a.value === b.value) return a.exclusive ? a : b;
  return a.value < b.value ? a : b;
}

/** Collapse a condition to its simplest equivalent form. */
function simplify(condition: Condition): Condition {
  if (condition.unsatisfiable) return UNSATISFIABLE;

  if (condition.eq !== undefined) {
    const { eq, ...rest } = condition;
    return matchesCondition(eq, rest) ? { eq } : UNSATISFIABLE;
  }

  if (condition.in !== undefined) {
    const range: Condition = { lower: condition.lower, upper: condition.upper };
    const values = condition.in.filter((value) =>
      matchesCondition(value, range),
    );
    if (values.length === 0) return UNSATISFIABLE;
    if (values.length === 1) return { eq: values[0] };
    return { in: values };
  }

  return simplifyParts(condition);
}

/** Simplify a range-only condition (no eq / in parts). */
function simplifyParts(condition: Condition): Condition {
  const { lower, upper } = condition;
  if (lower && upper) {
    if (lower.value > upper.value) return UNSATISFIABLE;
    if (lower.value === upper.value) {
      if (lower.exclusive || upper.exclusive) return UNSATISFIABLE;
      return { eq: lower.value };
    }
  }
  const result: Condition = {};
  if (lower) result.lower = lower;
  if (upper) result.upper = upper;
  return result;
}

function matchesCondition(value: unknown, condition: Condition): boolean {
  if (condition.unsatisfiable) return false;
  if (condition.eq !== undefined) return value === condition.eq;
  if (condition.in !== undefined && !condition.in.includes(value as Scalar)) {
    return false;
  }
  if (condition.lower || condition.upper) {
    if (typeof value !== "string" && typeof value !== "number") return false;
    const { lower, upper } = condition;
    if (lower) {
      if (typeof value !== typeof lower.value) return false;
      if (lower.exclusive ? value <= lower.value : value < lower.value) {
        return false;
      }
    }
    if (upper) {
      if (typeof value !== typeof upper.value) return false;
      if (upper.exclusive ? value >= upper.value : value > upper.value) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Build a wire filter from author input: fields set to `undefined`
 * mean "no constraint" and are dropped.
 */
export function compactFilter(
  filter: Record<string, FieldFilter | undefined> | undefined,
): WhereFilter {
  const result: WhereFilter = {};
  for (const [field, value] of Object.entries(filter ?? {})) {
    if (value !== undefined) result[field] = value;
  }
  return result;
}

/** Does a record match every field condition of a wire filter? */
export function matchesFilter(
  record: Record<string, unknown>,
  filter: WhereFilter,
): boolean {
  for (const [field, fieldFilter] of Object.entries(filter)) {
    if (!matchesCondition(record[field], normalize(fieldFilter))) return false;
  }
  return true;
}

/**
 * AND two filters together. Returns the combined filter, or `null` when
 * the intersection is provably empty (no record can match both).
 */
export function intersectFilters(
  a: WhereFilter,
  b: WhereFilter,
): WhereFilter | null {
  const result: WhereFilter = { ...a };
  for (const [field, fieldFilter] of Object.entries(b)) {
    const existing = result[field];
    if (existing === undefined) {
      result[field] = fieldFilter;
      continue;
    }
    const combined = intersectConditions(
      normalize(existing),
      normalize(fieldFilter),
    );
    if (combined.unsatisfiable) return null;
    result[field] = denormalize(combined);
  }
  return result;
}

function intersectConditions(a: Condition, b: Condition): Condition {
  if (a.unsatisfiable || b.unsatisfiable) return UNSATISFIABLE;
  if (a.eq !== undefined && b.eq !== undefined && a.eq !== b.eq) {
    return UNSATISFIABLE;
  }
  const aIn = a.in;
  const bIn = b.in;
  const merged: Condition = {
    eq: a.eq ?? b.eq,
    in: aIn && bIn ? aIn.filter((value) => bIn.includes(value)) : (aIn ?? bIn),
    lower:
      a.lower && b.lower
        ? tighterLower(a.lower, b.lower)
        : (a.lower ?? b.lower),
    upper:
      a.upper && b.upper
        ? tighterUpper(a.upper, b.upper)
        : (a.upper ?? b.upper),
  };
  if (merged.eq === undefined) delete merged.eq;
  if (merged.in === undefined) delete merged.in;
  if (merged.lower === undefined) delete merged.lower;
  if (merged.upper === undefined) delete merged.upper;
  return simplify(merged);
}

function denormalize(condition: Condition): FieldFilter {
  if (condition.eq !== undefined) return condition.eq;
  const filter: Exclude<FieldFilter, Scalar> = {};
  if (condition.in) filter.in = condition.in;
  if (condition.lower) {
    filter[condition.lower.exclusive ? "gt" : "gte"] = condition.lower.value;
  }
  if (condition.upper) {
    filter[condition.upper.exclusive ? "lt" : "lte"] = condition.upper.value;
  }
  return filter;
}

/**
 * Is every record matching `fine` guaranteed to match `coarse`?
 *
 * Used by coverage: if the set described by `coarse` has been fully
 * synced, any narrower query (`fine`) is complete locally and can be
 * answered without the network. Conservative - returns `false` whenever
 * subsumption cannot be proven.
 */
export function filterSubsumes(
  coarse: WhereFilter,
  fine: WhereFilter,
): boolean {
  for (const [field, coarseFilter] of Object.entries(coarse)) {
    const fineFilter = fine[field];
    if (fineFilter === undefined) return false;
    if (!conditionSubsumes(normalize(coarseFilter), normalize(fineFilter))) {
      return false;
    }
  }
  return true;
}

function conditionSubsumes(coarse: Condition, fine: Condition): boolean {
  if (fine.unsatisfiable) return true;
  if (coarse.unsatisfiable) return false;

  // Finite fine sets: check every possible value against the coarse set.
  if (fine.eq !== undefined) return matchesCondition(fine.eq, coarse);
  if (fine.in !== undefined) {
    return fine.in.every((value) => matchesCondition(value, coarse));
  }

  // Fine is an interval (or unbounded): only a wider interval subsumes it.
  if (coarse.eq !== undefined || coarse.in !== undefined) return false;
  if (coarse.lower) {
    if (!fine.lower) return false;
    if (typeof fine.lower.value !== typeof coarse.lower.value) return false;
    if (fine.lower.value < coarse.lower.value) return false;
    if (
      fine.lower.value === coarse.lower.value &&
      coarse.lower.exclusive &&
      !fine.lower.exclusive
    ) {
      return false;
    }
  }
  if (coarse.upper) {
    if (!fine.upper) return false;
    if (typeof fine.upper.value !== typeof coarse.upper.value) return false;
    if (fine.upper.value > coarse.upper.value) return false;
    if (
      fine.upper.value === coarse.upper.value &&
      coarse.upper.exclusive &&
      !fine.upper.exclusive
    ) {
      return false;
    }
  }
  return true;
}
