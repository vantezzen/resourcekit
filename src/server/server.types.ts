import type { z } from "zod";
import type { OpaqueActionNames } from "../core/action.types";
import type { SourceBackbone } from "../core/backbone";
import type { QueryInput } from "../core/query.types";
import type {
  AnyResource,
  IdScalar,
  ResourcesByName,
} from "../core/resource.types";
import type { WhereInput } from "../plan/filters.types";
import type { WritePlan } from "../plan/write-plan";

/**
 * Access is declared once per served resource and enforced everywhere:
 * the scope filter is AND-ed into every read, and every write is
 * checked against it - both the record's current state and (for
 * patches) its patched state, so records can't be edited from or moved
 * out of scope. ResourceKit denies by default: a resource without an
 * access rule refuses all plans.
 */
export type AccessRule<T, TCtx> =
  | "public"
  | ((ctx: TCtx) => WhereInput<T> | Promise<WhereInput<T>>);

export type RecordOf<R extends AnyResource> = z.infer<R["schema"]>;

/** Runtime shape of one opaque-action implementation. */
export type OpaqueActionImpl<TCtx> = (args: {
  id: IdScalar;
  input: unknown;
  record: Record<string, unknown>;
  ctx: TCtx;
}) => unknown | Promise<unknown>;

/** Author-facing, precisely typed implementations per opaque action. */
export type ActionImpls<R extends AnyResource, TCtx> = {
  [K in OpaqueActionNames<R["actionDefs"]>]: (args: {
    id: IdScalar;
    input: z.infer<R["actionDefs"][K]["input"]>;
    record: RecordOf<R>;
    ctx: TCtx;
  }) => unknown | Promise<unknown>;
};

/** Runtime shape of one named-query implementation. */
export type NamedQueryImpl<TCtx> = (args: {
  input: unknown;
  ctx: TCtx;
}) => unknown | Promise<unknown>;

/** Author-facing, precisely typed implementations per named query. */
export type NamedQueryImpls<R extends AnyResource, TCtx> = {
  [K in keyof R["queryDefs"]]: (args: {
    input: z.infer<R["queryDefs"][K]["input"]>;
    ctx: TCtx;
  }) =>
    | z.infer<R["queryDefs"][K]["output"]>
    | Promise<z.infer<R["queryDefs"][K]["output"]>>;
};

export type ServeResourceConfig<R extends AnyResource, TCtx> = {
  /** The authoritative backbone for this resource (Drizzle, memory, …). */
  backbone: SourceBackbone;
  /** Required: `"public"` or a scope derived from the request context. */
  access: AccessRule<RecordOf<R>, TCtx>;
} & OpaqueActions<R, TCtx> &
  NamedQueries<R, TCtx>;

/** `actions` is required exactly when the resource declares opaque actions. */
type OpaqueActions<R extends AnyResource, TCtx> = [
  OpaqueActionNames<R["actionDefs"]>,
] extends [never]
  ? {
      /** This resource declares no opaque actions. */
      actions?: undefined;
    }
  : {
      /** Implementations for the actions declared with `run: null`. */
      actions: ActionImpls<R, TCtx>;
    };

/** `queries` is required exactly when the resource declares named queries. */
type NamedQueries<R extends AnyResource, TCtx> = [
  keyof R["queryDefs"],
] extends [never]
  ? {
      /** This resource declares no named queries. */
      queries?: undefined;
    }
  : {
      /** Implementations for the resource's named queries. */
      queries: NamedQueryImpls<R, TCtx>;
    };

/**
 * The serve config as the runtime sees it - one shape for every
 * resource, fully typed but without the per-resource precision the
 * author-facing `ServeResourceConfig` enforces at the call site.
 */
export type AnyServeConfig<TCtx> = {
  backbone: SourceBackbone;
  access: "public" | ((ctx: TCtx) => unknown) | undefined;
  actions?: Record<string, OpaqueActionImpl<TCtx>>;
  queries?: Record<string, NamedQueryImpl<TCtx>>;
};

export type ServerConfig<Resources extends readonly AnyResource[], TCtx> = {
  /**
   * Build the per-request context (db handles, auth, …).
   *
   * Annotate the parameter (`(req: Request) => …`) - an unannotated
   * parameter defers TypeScript's inference, which can leave the
   * context type `unknown` inside access rules and action
   * implementations.
   */
  ctx: (request: Request) => TCtx | Promise<TCtx>;
  /**
   * The most rows one `where` read may return (default 1000). Larger
   * results fail loudly with a `result_limit` error - narrow the
   * filter or window the set with `.take(n)`.
   */
  maxRows?: number;
  resources: {
    // NoInfer: the `ctx` resolver alone determines TCtx, so annotated
    // access/action callbacks check against it instead of widening it.
    [K in keyof ResourcesByName<Resources>]: ServeResourceConfig<
      ResourcesByName<Resources>[K],
      NoInfer<TCtx>
    >;
  };
};

export type ServerSession = {
  query<TResult>(input: QueryInput<TResult>): Promise<TResult>;
  mutate<TResult>(plan: WritePlan<TResult>): Promise<TResult>;
};
