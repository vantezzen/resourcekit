import {
  ResourceRegistry,
  type ExecutionContext,
  type SourceBackbone,
} from "../core/backbone";
import type { Engine } from "../core/engine";
import { applyRefinements, toQuery } from "../core/query";
import type { QueryInput } from "../core/query.types";
import type {
  AnyResource,
  ResourceOperation,
} from "../core/resource.types";
import { validate, validatePatch } from "../core/validate";
import {
  AccessDeniedError,
  ConflictError,
  InvalidInputError,
  NoBackboneError,
  NotFoundError,
  ResourceKitError,
  UnsupportedOperationError,
} from "../errors";
import {
  intersectFilters,
  matchesFilter,
  type WhereFilter,
} from "../plan/filters";
import { isReadPlan, type QueryPlan } from "../plan/plan";
import type { ReadPlan } from "../plan/read-plan";
import type { WriteAction, WritePlan } from "../plan/write-plan";
import {
  SyncMessageSchema,
  type PlanResult,
  type SyncResponse,
  type WireError,
} from "../sync/protocol";
import { debug } from "../debug";
import { ChangeFeed, eventsResponse } from "./change-feed";
import type {
  AnyServeConfig,
  ServerConfig,
  ServerSession,
} from "./server.types";

export { ChangeFeed } from "./change-feed";
export { channel, redisChannel } from "./channels";
export type {
  ChangeChannel,
  RedisChannelOptions,
  RedisClient,
  RedisPublisher,
  RedisSubscriber,
} from "./channel.types";
export type {
  AccessRule,
  ActionImpls,
  AnyServeConfig,
  NamedQueryImpl,
  NamedQueryImpls,
  OpaqueActionImpl,
  RecordOf,
  ServeResourceConfig,
  ServerConfig,
  ServerSession,
} from "./server.types";

const DEFAULT_MAX_ROWS = 1_000;

type Row = Record<string, unknown>;

/**
 * The server side of the sync protocol. One instance serves every
 * request - context flows through, never into, the runtime.
 *
 * Plan handling is orchestration, so adapters stay tiny: the server
 * validates input against the resource schema, enforces access scopes,
 * lowers declarative actions against the canonical record, and only
 * then hands `one / where / create / patch / delete` to the backbone.
 */
export class ResourceServer<Resources extends readonly AnyResource[], TCtx> {
  /**
   * The author-facing config is precisely typed per resource; the
   * runtime works with one shape. This is the single typed↔runtime
   * boundary.
   */
  private readonly serves: Record<string, AnyServeConfig<TCtx>>;
  private readonly maxRows: number;

  /** Emits after every accepted write - bridge to your pub/sub or `events`. */
  readonly changes = new ChangeFeed();

  /** Server-Sent Events endpoint streaming the change feed (`GET`). */
  events = (request: Request): Response =>
    eventsResponse(this.changes, request);

  constructor(
    private readonly registry: ResourceRegistry,
    private readonly config: ServerConfig<Resources, TCtx>,
  ) {
    this.serves = config.resources as Record<string, AnyServeConfig<TCtx>>;
    this.maxRows = config.maxRows ?? DEFAULT_MAX_ROWS;
  }

  /** Mount at your sync endpoint: `export const POST = sync.POST`. */
  POST = async (request: Request): Promise<Response> => {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse(400, {
        code: "invalid_input",
        message: "Request body is not valid JSON.",
      });
    }

    const message = SyncMessageSchema.safeParse(body);
    if (!message.success) {
      return errorResponse(400, {
        code: "invalid_input",
        message: "Invalid sync message format.",
      });
    }

    const ctx = await this.config.ctx(request);
    const results: PlanResult[] = [];
    // Sequential on purpose: a batch's writes land in submission order.
    for (const plan of message.data.plans) {
      try {
        results.push({ ok: true, data: await this.handlePlan(plan, ctx) });
        debug.server("%s %s: ok", plan.op, plan.resource);
      } catch (error) {
        console.error(error);
        const wire = toWireError(error);
        debug.server(
          "%s %s: %s (%s): %s",
          plan.op,
          plan.resource,
          wire.code,
          wire.message,
          (error as Error)?.message,
        );
        results.push({ ok: false, error: wire });
      }
    }
    return Response.json({ ok: true, results } satisfies SyncResponse);
  };

  /**
   * Execute reads and writes with an explicit context - the same data
   * path as the sync endpoint, for RSC, loaders, scripts, and tests.
   */
  session(ctx: TCtx): ServerSession {
    return {
      query: async <TResult>(input: QueryInput<TResult>) => {
        const query = toQuery(input);
        const raw = await this.handlePlan(query.plan, ctx);
        return (
          query.shape === "many"
            ? applyRefinements(Array.isArray(raw) ? raw : [], query.refinements)
            : (raw ?? null)
        ) as TResult;
      },
      mutate: <TResult>(plan: WritePlan<TResult>) =>
        this.handlePlan(plan, ctx) as Promise<TResult>,
    };
  }

  async handlePlan(plan: QueryPlan, ctx: TCtx): Promise<unknown> {
    const resource = this.registry.get(plan.resource);
    // Type-gating stops a typed client from building an unsupported plan;
    // this is the runtime backstop for dynamic, hand-built, or stale-
    // client plans that the resource's declared capabilities exclude.
    assertSupported(plan, resource);
    const serve = this.serveFor(plan.resource);
    const scope = await this.scopeFor(serve, ctx, plan.resource);
    const exec: ExecutionContext<TCtx> = { resources: this.registry, ctx };

    if (isReadPlan(plan)) {
      return this.handleRead(plan, resource, serve, scope, exec);
    }
    const result = await this.handleWrite(plan, resource, serve, scope, exec);
    this.changes.emit({ resource: plan.resource });
    return result;
  }

  private async handleRead(
    plan: ReadPlan,
    resource: AnyResource,
    serve: AnyServeConfig<TCtx>,
    scope: WhereFilter | null,
    exec: ExecutionContext<TCtx>,
  ): Promise<unknown> {
    if (plan.op === "named") {
      return this.handleNamedQuery(
        plan.name,
        plan.input,
        resource,
        serve,
        exec,
      );
    }

    if (plan.op === "where") {
      const filter = scope ? intersectFilters(plan.filter, scope) : plan.filter;
      if (filter === null) return []; // Provably outside the caller's scope.

      if (plan.limit !== undefined) {
        if (plan.limit > this.maxRows) {
          throw new InvalidInputError(
            `.take(${plan.limit}) exceeds this server's maxRows (${this.maxRows}).`,
          );
        }
        return serve.backbone.execute({ ...plan, filter }, exec);
      }

      // Probe one row past the cap so oversized sets fail loudly
      // instead of silently truncating (which would poison coverage).
      const probed = (await serve.backbone.execute(
        { ...plan, filter, limit: this.maxRows + 1 },
        exec,
      )) as unknown[];
      if (probed.length > this.maxRows) {
        throw new ResourceKitError(
          "result_limit",
          `"${plan.resource}" matched more than ${this.maxRows} rows. ` +
            `Narrow the filter, window the set with .take(n), or raise maxRows.`,
        );
      }
      return probed;
    }

    const record = await serve.backbone.execute(plan, exec);
    if (record && scope && !matchesFilter(record as Row, scope)) return null;
    return record;
  }

  private async handleNamedQuery(
    name: string,
    rawInput: unknown,
    resource: AnyResource,
    serve: AnyServeConfig<TCtx>,
    exec: ExecutionContext<TCtx>,
  ): Promise<unknown> {
    const def = resource.queryDefs[name];
    if (!def) {
      throw new InvalidInputError(
        `Unknown query "${name}" on resource "${resource.name}".`,
      );
    }
    const impl = serve.queries?.[name];
    if (!impl) {
      throw new ResourceKitError(
        "internal",
        `Query "${resource.name}.${name}" has no server implementation. ` +
          `Provide one in the serve config: queries: { ${name}: async ({ input, ctx }) => … }`,
      );
    }
    const input = validate(
      def.input,
      rawInput,
      `${resource.name}.${name} input`,
    );
    const result = await impl({ input, ctx: exec.ctx });
    return validate(def.output, result, `${resource.name}.${name} result`);
  }

  private async handleWrite(
    plan: WritePlan,
    resource: AnyResource,
    serve: AnyServeConfig<TCtx>,
    scope: WhereFilter | null,
    exec: ExecutionContext<TCtx>,
  ): Promise<unknown> {
    switch (plan.op) {
      case "create": {
        const record = validate(
          resource.schema,
          plan.record,
          `${resource.name}.create record`,
        ) as Row;
        this.assertInScope(scope, record, resource.name, "create");
        return serve.backbone.execute({ ...plan, record }, exec);
      }

      case "patch": {
        const patch = validatePatch(
          resource.schema,
          plan.patch,
          `${resource.name}.update patch`,
        );
        const current = await this.currentRecord(plan, serve.backbone, exec);
        if (!current) throw new NotFoundError(resource.name, plan.id);
        return this.applyPatch(
          plan.id,
          patch,
          current,
          resource,
          serve,
          scope,
          exec,
          plan.baseVersion,
        );
      }

      case "delete": {
        const current = await this.currentRecord(plan, serve.backbone, exec);
        if (!current) return null; // Idempotent: replays of a delete are fine.
        this.assertInScope(scope, current, resource.name, "delete");
        return serve.backbone.execute(plan, exec);
      }

      case "action":
        return this.handleAction(plan, resource, serve, scope, exec);
    }
  }

  private async handleAction(
    plan: WriteAction,
    resource: AnyResource,
    serve: AnyServeConfig<TCtx>,
    scope: WhereFilter | null,
    exec: ExecutionContext<TCtx>,
  ): Promise<unknown> {
    const def = resource.actionDefs[plan.action];
    if (!def) {
      throw new InvalidInputError(
        `Unknown action "${plan.action}" on resource "${resource.name}".`,
      );
    }
    const input = validate(
      def.input,
      plan.input,
      `${resource.name}.${plan.action} input`,
    );
    const current = await this.currentRecord(plan, serve.backbone, exec);
    if (!current) throw new NotFoundError(resource.name, plan.id);
    this.assertInScope(scope, current, resource.name, plan.action);

    if (def.run) {
      // Declarative: lower against the canonical record, then patch.
      const patch = validatePatch(
        resource.schema,
        def.run({ input, record: current }),
        `${resource.name}.${plan.action} patch`,
      );
      return this.applyPatch(
        plan.id,
        patch,
        current,
        resource,
        serve,
        scope,
        exec,
        plan.baseVersion,
      );
    }

    const impl = serve.actions?.[plan.action];
    if (!impl) {
      throw new ResourceKitError(
        "internal",
        `Action "${resource.name}.${plan.action}" has no declarative lowering ` +
          `and no server implementation. Provide one in the serve config: ` +
          `actions: { ${plan.action}: async ({ id, input, record, ctx }) => … }`,
      );
    }
    return impl({ id: plan.id, input, record: current, ctx: exec.ctx });
  }

  private async applyPatch(
    id: string | number,
    patch: Row,
    current: Row,
    resource: AnyResource,
    serve: AnyServeConfig<TCtx>,
    scope: WhereFilter | null,
    exec: ExecutionContext<TCtx>,
    baseVersion?: number,
  ): Promise<unknown> {
    let finalPatch = patch;
    if (resource.version) {
      const currentVersion = current[resource.version];
      if (baseVersion !== undefined && currentVersion !== baseVersion) {
        throw new ConflictError(
          `"${resource.name}" record "${id}" was modified by someone else ` +
            `(version ${currentVersion}, this write was based on ${baseVersion}).`,
        );
      }
      if (typeof currentVersion === "number") {
        finalPatch = { ...patch, [resource.version]: currentVersion + 1 };
      }
    }

    this.assertInScope(scope, current, resource.name, "modify");
    // A patch must not move the record out of the caller's scope either.
    this.assertInScope(
      scope,
      { ...current, ...finalPatch },
      resource.name,
      "modify",
    );
    return serve.backbone.execute(
      {
        type: "write",
        resource: resource.name,
        op: "patch",
        id,
        patch: finalPatch,
      },
      exec,
    );
  }

  private async currentRecord(
    plan: Extract<WritePlan, { id: string | number }>,
    backbone: SourceBackbone,
    exec: ExecutionContext<TCtx>,
  ): Promise<Row | null> {
    const record = await backbone.execute(
      { type: "read", resource: plan.resource, op: "one", id: plan.id },
      exec,
    );
    return (record as Row | null) ?? null;
  }

  private serveFor(name: string): AnyServeConfig<TCtx> {
    const serve = this.serves[name];
    if (!serve) {
      throw new NoBackboneError(
        `Resource "${name}" is not served by this server. ` +
          `Add it to the server's resources map.`,
      );
    }
    return serve;
  }

  private async scopeFor(
    serve: AnyServeConfig<TCtx>,
    ctx: TCtx,
    name: string,
  ): Promise<WhereFilter | null> {
    if (serve.access === undefined) {
      throw new AccessDeniedError(
        `Resource "${name}" has no access rule - ResourceKit denies by default. ` +
          `Declare access: "public" or a scope function in the serve config.`,
      );
    }
    if (serve.access === "public") return null;
    return (await serve.access(ctx)) as WhereFilter;
  }

  private assertInScope(
    scope: WhereFilter | null,
    record: Row,
    resource: string,
    verb: string,
  ): void {
    if (scope && !matchesFilter(record, scope)) {
      throw new AccessDeniedError(
        `Not allowed to ${verb} this "${resource}" record (outside your access scope).`,
      );
    }
  }
}

/**
 * Create the server side of the sync protocol from an engine or a
 * plain resource list (so server code never has to construct a client
 * engine just to hand over its resources).
 *
 * @example
 * ```ts
 * export const sync = server([issues], {
 *   ctx: async (req) => ({ db, auth: await getAuth(req) }),
 *   resources: {
 *     issues: {
 *       backbone: drizzleBackbone(db, issuesTable),
 *       access: (ctx) => ({ workspaceId: { in: ctx.auth.workspaceIds } }),
 *     },
 *   },
 * });
 *
 * export const POST = sync.POST;
 * ```
 */
export function server<const Resources extends readonly AnyResource[], TCtx>(
  source: Engine<Resources> | Resources,
  config: ServerConfig<Resources, TCtx>,
): ResourceServer<Resources, TCtx> {
  const registry = isEngine(source)
    ? source.registry
    : new ResourceRegistry(source);
  return new ResourceServer(registry, config);
}

function isEngine<Resources extends readonly AnyResource[]>(
  source: Engine<Resources> | Resources,
): source is Engine<Resources> {
  return !Array.isArray(source);
}

function toWireError(error: unknown): WireError {
  if (error instanceof ResourceKitError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "internal",
    message: error instanceof Error ? error.message : "Internal error.",
  };
}

function errorResponse(status: number, error: WireError): Response {
  return Response.json({ ok: false, error } satisfies SyncResponse, { status });
}

/**
 * The primitive operation a plan exercises, or `null` for plans gated by
 * their own declaration rather than `supports` (named queries by
 * `queryDefs`, actions by `actionDefs`).
 */
function operationOf(plan: QueryPlan): ResourceOperation | null {
  if (plan.type === "read") {
    if (plan.op === "one") return "one";
    if (plan.op === "where") return "where";
    return null; // named
  }
  switch (plan.op) {
    case "create":
      return "create";
    case "patch":
      return "update";
    case "delete":
      return "delete";
    case "action":
      return null;
  }
}

function assertSupported(plan: QueryPlan, resource: AnyResource): void {
  const op = operationOf(plan);
  if (op && !resource.supports.includes(op)) {
    throw new UnsupportedOperationError(
      `Resource "${plan.resource}" does not support the "${op}" operation ` +
        `(it supports: ${resource.supports.join(", ") || "none"}).`,
    );
  }
}
