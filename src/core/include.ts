import type { ReadPlan } from "../plan/read-plan";
import type { ExecutionContext } from "./backbone.types";
import type { IncludeSpec } from "./relation.types";

type Row = Record<string, unknown>;
type Id = string | number;

/**
 * Includes are local hash joins over cached collections. The only data
 * that has to exist is the related set - `childPlanFor` describes it as
 * an ordinary `where` plan (so the runtime syncs and caches it like any
 * other query), and `joinIncludes` attaches the related records.
 */

/** The related set an include needs, as a plan - or `null` when the base is empty. */
export function childPlanFor(
  spec: IncludeSpec,
  baseResource: string,
  baseRows: readonly Row[],
  exec: ExecutionContext,
): ReadPlan | null {
  const target = spec.relation.target();
  const raw =
    spec.relation.kind === "one"
      ? baseRows.map((row) => row[spec.relation.field])
      : baseRows.map((row) => exec.resources.idOf(baseResource, row));
  const ids = [...new Set(raw)]
    .filter((id): id is Id => typeof id === "string" || typeof id === "number")
    .sort();
  if (ids.length === 0) return null;

  const field =
    spec.relation.kind === "one" ? target.identity : spec.relation.field;
  return {
    type: "read",
    resource: target.name,
    op: "where",
    filter: { [field]: { in: ids } },
  };
}

/** Attach related records to each base row under the include's key. */
export function joinIncludes(
  baseResource: string,
  baseRows: readonly Row[],
  specs: readonly IncludeSpec[],
  related: ReadonlyMap<string, readonly Row[]>,
  exec: ExecutionContext,
): Row[] {
  const lookups = specs.map((spec) => {
    const target = spec.relation.target();
    const rows = related.get(spec.key) ?? [];
    if (spec.relation.kind === "one") {
      const byId = new Map(rows.map((row) => [row[target.identity], row]));
      return (base: Row) => byId.get(base[spec.relation.field]) ?? null;
    }
    const groups = new Map<unknown, Row[]>();
    for (const row of rows) {
      const key = row[spec.relation.field];
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    return (base: Row) =>
      groups.get(exec.resources.idOf(baseResource, base)) ?? [];
  });

  return baseRows.map((base) => {
    const joined: Row = { ...base };
    specs.forEach((spec, index) => {
      joined[spec.key] = lookups[index]?.(base) ?? null;
    });
    return joined;
  });
}
