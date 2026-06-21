import type { z } from "zod";
import type { AnyResource } from "./resource.types";

export type RelationKind = "one" | "many";

export type RelationDef<
  TTarget extends AnyResource = AnyResource,
  TKind extends RelationKind = RelationKind,
> = {
  readonly kind: TKind;
  /** Lazy, so resources can reference each other across modules. */
  readonly target: () => TTarget;
  /**
   * `one`: the local field holding the target's identity.
   * `many`: the target's field holding this record's identity.
   */
  readonly field: string;
};

export type AnyRelationDef = RelationDef;

/** What an included relation adds to each record. */
export type RelationResult<TRelation extends AnyRelationDef> =
  TRelation extends RelationDef<infer TTarget, "one">
    ? z.infer<TTarget["schema"]> | null
    : TRelation extends RelationDef<infer TTarget, "many">
      ? z.infer<TTarget["schema"]>[]
      : never;

export type IncludedShape<
  TRelations extends Record<string, AnyRelationDef>,
  K extends keyof TRelations,
> = {
  [P in K]: RelationResult<TRelations[P]>;
};

/** A resolved `.include()` entry carried on a query. */
export type IncludeSpec = {
  readonly key: string;
  readonly relation: AnyRelationDef;
};
