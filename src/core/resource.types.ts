import type { z } from "zod";
import type { WhereInput } from "../plan/filters.types";
import type { WritePlan } from "../plan/write-plan";
import type { ActionDefinition, AnyActionDefinition } from "./action.types";
import type {
  AnyNamedQueryDef,
  NamedQueryFactories,
} from "./named-query.types";
import type { CollectionQuery } from "./query";
import type { Query } from "./query.types";
import type { AnyRelationDef } from "./relation.types";

/**
 * How a resource behaves locally. Not every resource is a table:
 * - `collection` - individually stored records, queryable locally (Postgres rows)
 * - `document`   - one record by id, usually editable (a Redis hash, a settings doc)
 * - `snapshot`   - cached result of a read, replaced wholesale (a report)
 * - `blob`       - large content addressed by id, loaded on demand (an S3 body)
 * - `connection` - online-only; same API shape, no offline promise (a live feed)
 */
export type ResourceMode =
  | "collection"
  | "document"
  | "snapshot"
  | "blob"
  | "connection";

/**
 * The primitive operations a resource can expose. A resource only
 * surfaces the methods for the operations it `supports`, so calling an
 * unsupported one is a *type* error - never a method that throws.
 */
export type ResourceOperation =
  | "one"
  | "where"
  | "create"
  | "update"
  | "delete";

/**
 * The effective operation set. A resource exposes every operation unless
 * it declares a narrower `supports` list - so `mode` stays purely about
 * local cache behavior, and capabilities are an independent, opt-in knob
 * (a backbone that can't do everything ships a fragment that sets it).
 */
export type EffectiveOperations<
  TSupports extends readonly ResourceOperation[] | undefined,
> = TSupports extends readonly ResourceOperation[]
  ? TSupports[number]
  : ResourceOperation;

/** Identity values as they appear in records and plans. */
export type IdScalar = string | number;

/** The identity value type of a record, given its identity field. */
export type IdOf<T, TIdentity> = TIdentity extends keyof T
  ? T[TIdentity] & IdScalar
  : IdScalar;

export type ActionFactories<
  T,
  TId,
  TActions extends Record<string, AnyActionDefinition>,
> = {
  [K in keyof TActions]: (
    id: TId,
    input: z.infer<TActions[K]["input"]>,
  ) => WritePlan<
    // Declarative actions resolve to the patched record; opaque ones
    // resolve to whatever their server implementation returns.
    TActions[K]["run"] extends null ? unknown : T
  >;
};

export type Resource<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  TActions extends Record<string, AnyActionDefinition> = {},
  TIdentity extends string = "id",
  TRelations extends Record<string, AnyRelationDef> = {},
  TQueries extends Record<string, AnyNamedQueryDef> = {},
  TMode extends ResourceMode = "collection",
  TSupports extends readonly ResourceOperation[] | undefined = undefined,
> = ResourceApi<
  TName,
  TSchema,
  TActions,
  TIdentity,
  TRelations,
  TQueries,
  z.infer<TSchema>,
  IdOf<z.infer<TSchema>, TIdentity>,
  EffectiveOperations<TSupports>
>;

/** The part of a resource that exists regardless of supported operations. */
type ResourceCore<
  TName extends string,
  TSchema extends z.ZodType,
  TActions extends Record<string, AnyActionDefinition>,
  TIdentity extends string,
  TRelations extends Record<string, AnyRelationDef>,
  TQueries extends Record<string, AnyNamedQueryDef>,
  T,
  TId,
> = {
  readonly name: TName;
  readonly schema: TSchema;
  readonly identity: TIdentity;
  readonly mode: ResourceMode;
  /** The operations this resource exposes (and the server will accept). */
  readonly supports: readonly ResourceOperation[];
  /** The numeric field used for conflict detection, if declared. */
  readonly version: string | null;
  /** Raw action definitions, used by the runtime for lowering and validation. */
  readonly actionDefs: TActions;
  /** Raw named-query definitions, used by the runtime for validation. */
  readonly queryDefs: TQueries;
  /** Relations available to `.include()`. */
  readonly relations: TRelations;

  /** Typed factories for the actions declared on this resource. */
  readonly actions: ActionFactories<T, TId, TActions>;
  /** Typed factories for the named server queries declared on this resource. */
  readonly queries: NamedQueryFactories<TQueries>;
};

/** Read methods, present only for the operations the resource supports. */
type ResourceReads<
  TOps extends ResourceOperation,
  T,
  TId,
  TRelations extends Record<string, AnyRelationDef>,
> = ("one" extends TOps
  ? {
      /** Read one record by identity. Resolves to the record or `null`. */
      one(id: TId): Query<T | null>;
    }
  : {}) &
  ("where" extends TOps
    ? {
        /**
         * Read the records matching a filter. Chain
         * `.filter() / .orderBy() / .limit()` for anything richer - those
         * run locally and never hit the network. Chain `.take(n)` to
         * window large sets, `.include(...)` to join relations.
         */
        where(filter?: WhereInput<T>): CollectionQuery<T, TRelations>;
      }
    : {});

/** Write methods, present only for the operations the resource supports. */
type ResourceWrites<
  TOps extends ResourceOperation,
  T,
  TId,
  TSchema extends z.ZodType,
> = ("create" extends TOps
  ? {
      /**
       * Create a record. Generate the id client-side (e.g.
       * `crypto.randomUUID()`); fields with schema defaults are optional.
       */
      create(record: z.input<TSchema>): WritePlan<T>;
    }
  : {}) &
  ("update" extends TOps
    ? {
        /** Patch a record by identity. */
        update(id: TId, patch: Partial<T>): WritePlan<T>;
      }
    : {}) &
  ("delete" extends TOps
    ? {
        /** Delete a record by identity. */
        delete(id: TId): WritePlan<null>;
      }
    : {});

/** `Resource` with the record (`T`), id (`TId`) and operation set bound once. */
type ResourceApi<
  TName extends string,
  TSchema extends z.ZodType,
  TActions extends Record<string, AnyActionDefinition>,
  TIdentity extends string,
  TRelations extends Record<string, AnyRelationDef>,
  TQueries extends Record<string, AnyNamedQueryDef>,
  T,
  TId,
  TOps extends ResourceOperation,
> = ResourceCore<
  TName,
  TSchema,
  TActions,
  TIdentity,
  TRelations,
  TQueries,
  T,
  TId
> &
  ResourceReads<TOps, T, TId, TRelations> &
  ResourceWrites<TOps, T, TId, TSchema>;

/** Loosely-typed resource view used by the runtime and registries. */
export type AnyResource = {
  readonly name: string;
  readonly schema: z.ZodType;
  readonly identity: string;
  readonly mode: ResourceMode;
  readonly supports: readonly ResourceOperation[];
  readonly version: string | null;
  readonly actionDefs: Record<string, AnyActionDefinition>;
  readonly queryDefs: Record<string, AnyNamedQueryDef>;
  readonly relations: Record<string, AnyRelationDef>;
  // Optional: a capability-gated resource omits the methods it doesn't
  // support, so the loose view must accept their absence. (At runtime
  // every method is present; nothing reads them through this view.)
  one?(id: any): Query<any>;
  where?(filter?: any): CollectionQuery<any, any>;
  create?(record: any): WritePlan<any>;
  update?(id: any, patch: any): WritePlan<any>;
  delete?(id: any): WritePlan<null>;
  readonly actions: Record<string, (id: any, input: any) => WritePlan<any>>;
  readonly queries: Record<string, (input: any) => any>;
};

/** A resource tuple as a name-keyed map (`[issues] → { issues }`). */
export type ResourcesByName<Resources extends readonly AnyResource[]> = {
  [K in Resources[number]["name"]]: Extract<Resources[number], { name: K }>;
};

export type ResourceConfig<
  TSchema extends z.ZodType,
  TActions extends Record<
    string,
    ActionDefinition<z.ZodType, Partial<z.infer<TSchema>>>
  >,
  TIdentity extends keyof z.infer<TSchema> & string,
  TRelations extends Record<string, AnyRelationDef>,
  TQueries extends Record<string, AnyNamedQueryDef>,
  TMode extends ResourceMode = "collection",
  TSupports extends readonly ResourceOperation[] | undefined = undefined,
> = {
  /** Zod schema describing one record. */
  schema: TSchema;
  /** The identity field (default: `"id"`). */
  identity?: TIdentity;
  /** Local behavior (default: `"collection"`). */
  mode?: TMode;
  /**
   * The operations this resource exposes. Defaults to the set implied by
   * `mode`; narrow it for partial backbones (an adapter typically ships a
   * capability fragment you spread in). Only the listed methods exist on
   * the resource, and the server rejects plans for the rest.
   */
  supports?: TSupports;
  /**
   * A numeric field used for conflict detection: writes carry the
   * version they were based on, the server rejects stale ones with a
   * `conflict` error and bumps the field on every accepted patch.
   */
  version?: keyof z.infer<TSchema> & string;
  /** Typed, named write operations. */
  actions?: TActions;
  /** Relations available to `.include()`. */
  relations?: TRelations;
  /** Typed, named server queries (search, reports, external APIs). */
  queries?: TQueries;
};
