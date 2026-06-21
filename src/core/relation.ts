import type { AnyResource } from "./resource.types";
import type { RelationDef } from "./relation.types";

/**
 * Relations connect resources for `.include()` - joins run locally over
 * cached data, and the runtime syncs the related records automatically.
 * Targets are lazy (`() => projects`) so resources can reference each
 * other across modules without import cycles.
 */

/** This record points at one target record: `this[field] → target id`. */
export function one<TTarget extends AnyResource>(
  target: () => TTarget,
  field: string,
): RelationDef<TTarget, "one"> {
  return { kind: "one", target, field };
}

/** Many target records point at this one: `target[field] → this id`. */
export function many<TTarget extends AnyResource>(
  target: () => TTarget,
  field: string,
): RelationDef<TTarget, "many"> {
  return { kind: "many", target, field };
}
