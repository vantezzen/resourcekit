import { z } from "zod";
import { compactFilter } from "../plan/filters";
import type { WritePlan } from "../plan/write-plan";
import type { ActionDefinition } from "./action.types";
import type {
  AnyNamedQueryDef,
  NamedQueryFactories,
} from "./named-query.types";
import { CollectionQuery, singleQuery, type QueryContext } from "./query";
import type { AnyRelationDef } from "./relation.types";
import type {
  ActionFactories,
  AnyResource,
  IdOf,
  IdScalar,
  Resource,
  ResourceConfig,
  ResourceMode,
  ResourceOperation,
} from "./resource.types";
import { validate, validatePatch } from "./validate";

/** Every primitive operation - the default capability set of a resource. */
export const ALL_OPERATIONS: readonly ResourceOperation[] = [
  "one",
  "where",
  "create",
  "update",
  "delete",
];

export function resource<
  TName extends string,
  TSchema extends z.ZodType,
  const TActions extends Record<
    string,
    ActionDefinition<z.ZodType, Partial<z.infer<TSchema>>>
  > = {},
  TIdentity extends keyof z.infer<TSchema> & string = "id" &
    keyof z.infer<TSchema>,
  const TRelations extends Record<string, AnyRelationDef> = {},
  const TQueries extends Record<string, AnyNamedQueryDef> = {},
  TMode extends ResourceMode = "collection",
  const TSupports extends readonly ResourceOperation[] | undefined = undefined,
>(
  name: TName,
  config: ResourceConfig<
    TSchema,
    TActions,
    TIdentity,
    TRelations,
    TQueries,
    TMode,
    TSupports
  >,
): Resource<
  TName,
  TSchema,
  TActions,
  TIdentity,
  TRelations,
  TQueries,
  TMode,
  TSupports
> {
  type T = z.infer<TSchema>;
  type TId = IdOf<T, TIdentity>;

  const { schema } = config;
  const identity = config.identity ?? ("id" as TIdentity);
  const mode = config.mode ?? "collection";
  const supports = config.supports ? [...config.supports] : [...ALL_OPERATIONS];
  const actionDefs = config.actions ?? ({} as TActions);
  const queryDefs = config.queries ?? ({} as TQueries);
  const relations = config.relations ?? ({} as TRelations);
  const context: QueryContext = { identity, relations };

  // Built dynamically, asserted once: the per-key input/output precision
  // of the factory maps cannot be expressed through Object.entries.
  const actionFactories: Record<string, unknown> = {};
  for (const [actionName, def] of Object.entries(actionDefs)) {
    actionFactories[actionName] = (
      id: IdScalar,
      input: unknown,
    ): WritePlan<any> => ({
      type: "write",
      resource: name,
      op: "action",
      action: actionName,
      id,
      input: validate(def.input, input, `${name}.${actionName} input`),
    });
  }
  const actions = actionFactories as ActionFactories<T, TId, TActions>;

  const queryFactories: Record<string, unknown> = {};
  for (const [queryName, def] of Object.entries(queryDefs)) {
    queryFactories[queryName] = (input: unknown) => {
      const plan = {
        type: "read",
        resource: name,
        op: "named",
        name: queryName,
        input: validate(def.input, input, `${name}.${queryName} input`),
      } as const;
      return def.output instanceof z.ZodArray
        ? new CollectionQuery(plan)
        : singleQuery(plan);
    };
  }
  const queries = queryFactories as NamedQueryFactories<TQueries>;

  // The runtime always carries every method (the registry's loose view
  // uses them); the precise `Resource` type omits the unsupported ones,
  // so a typed caller can't reach a method that the server would reject.
  const built: AnyResource = {
    name,
    schema,
    identity,
    mode,
    supports,
    version: config.version ?? null,
    actionDefs,
    queryDefs,
    relations,

    one: (id) => singleQuery({ type: "read", resource: name, op: "one", id }),

    where: (filter) =>
      new CollectionQuery(
        {
          type: "read",
          resource: name,
          op: "where",
          filter: compactFilter(filter),
        },
        undefined,
        context,
      ),

    create: (record) => ({
      type: "write",
      resource: name,
      op: "create",
      // The schema's output is opaque here (TSchema is generic); a
      // resource record is a plain object by contract.
      record: validate(schema, record, `${name}.create record`) as Record<
        string,
        unknown
      >,
    }),

    update: (id, patch) => ({
      type: "write",
      resource: name,
      op: "patch",
      id,
      patch: validatePatch(
        schema,
        patch as Record<string, unknown>,
        `${name}.update patch`,
      ),
    }),

    delete: (id) => ({ type: "write", resource: name, op: "delete", id }),

    actions,
    queries,
  };

  // The loose runtime shape (every method present) widens to the precise
  // capability-gated type; `unknown` because their `name`/method sets
  // intentionally differ.
  return built as unknown as Resource<
    TName,
    TSchema,
    TActions,
    TIdentity,
    TRelations,
    TQueries,
    TMode,
    TSupports
  >;
}
