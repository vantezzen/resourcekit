import { debug } from "../debug";
import { NoBackboneError, TransportError } from "../errors";
import { indexedDbStorage } from "../local/indexeddb-storage";
import { MemoryCacheBackbone } from "../local/memory-cache";
import type { WritePlan } from "../plan/write-plan";
import { eventSourceConnector } from "../sync/live";
import { RemoteSourceBackbone } from "../sync/remote-source";
import { fetchTransport } from "../sync/transport";
import { ResourceRegistry } from "./backbone";
import type { Bundle, PreloadArgs } from "./bundle.types";
import type { EngineConfig, EngineRuntime } from "./engine.types";
import { childPlanFor, joinIncludes } from "./include";
import { LiveQuery } from "./live-query";
import { MutationPipeline } from "./mutation-pipeline";
import { applyRefinements, toQuery } from "./query";
import type { Query, QueryInput } from "./query.types";
import { QueryStore } from "./query-store";
import type { AnyResource, ResourcesByName } from "./resource.types";

export type { EngineConfig } from "./engine.types";

type Row = Record<string, unknown>;

/**
 * The app-scoped runtime. Reads return local data immediately and
 * revalidate in the background; writes apply instantly and are
 * confirmed by the server (or replayed once back online). Opt into
 * `persist` for a cache that survives reloads and `live` for server
 * change notifications.
 *
 * The server side lives in `server` from `resourcekit/server`.
 */
export class Engine<
  const Resources extends readonly AnyResource[] = readonly AnyResource[],
> {
  readonly registry: ResourceRegistry;
  readonly resources: ResourcesByName<Resources>;

  /**
   * Resolves once persisted state is restored and recovered offline
   * writes are re-queued. Awaiting it is optional - queries before
   * readiness simply see an emptier cache.
   */
  readonly ready: Promise<void>;

  private readonly runtime: EngineRuntime;
  private readonly queryStore: QueryStore;
  private readonly pipeline: MutationPipeline;
  private readonly stopLive: (() => void) | null;

  constructor(config: EngineConfig<Resources>) {
    this.registry = new ResourceRegistry(config.resources);
    this.resources = Object.fromEntries(
      config.resources.map((res) => [res.name, res]),
    ) as ResourcesByName<Resources>;

    const storage =
      typeof config.persist === "string"
        ? indexedDbStorage(config.persist)
        : (config.persist ?? null);

    this.runtime = {
      cache:
        config.cache === null
          ? null
          : (config.cache ?? new MemoryCacheBackbone({ storage })),
      source:
        config.source === null
          ? null
          : (config.source ??
            new RemoteSourceBackbone(
              config.transport ?? fetchTransport(config.endpoint ?? "/sync"),
            )),
      exec: { resources: this.registry, ctx: undefined },
    };

    this.queryStore = new QueryStore({
      ...this.runtime,
      staleTime:
        config.staleTime === "forever"
          ? Number.POSITIVE_INFINITY
          : (config.staleTime ?? 0),
      retention: config.retention ?? 1_000,
    });
    this.pipeline = new MutationPipeline(this.runtime);

    // Writes queued when the last session ended resume automatically.
    const { cache } = this.runtime;
    const pipeline = this.pipeline;
    this.ready = (async () => {
      if (!cache) return;
      pipeline.adopt(await cache.restored);
    })();

    if (config.live) {
      const connect =
        typeof config.live === "string"
          ? eventSourceConnector(config.live)
          : config.live;
      this.stopLive = connect((change) => {
        debug.live("change received: %s", change.resource);
        this.queryStore.refreshResource(change.resource);
      });
    } else {
      this.stopLive = null;
    }
  }

  /**
   * Read once. Answers from the local cache when it provably has the
   * full result, otherwise asks the server - falling back to local
   * data when offline.
   */
  async query<TResult>(input: QueryInput<TResult>): Promise<TResult> {
    const query = toQuery(input);
    const { plan } = query;
    const { source, exec } = this.runtime;
    this.registry.get(plan.resource);

    const cache = this.runtime.cache?.canFulfill(plan, exec)
      ? this.runtime.cache
      : null;

    if (cache) {
      const cached = await cache.read(plan, exec);
      if (cached.coverage === "complete") {
        debug.engine(
          "%s %s: served complete from cache",
          plan.op,
          plan.resource,
        );
        return this.materialize(query, cached.data);
      }
    }

    if (source?.canFulfill(plan, exec)) {
      try {
        debug.engine("%s %s: fetching from source", plan.op, plan.resource);
        const result = await source.execute(plan, exec);
        if (cache) await cache.ingest(plan, result, exec);
        return this.materialize(query, result);
      } catch (error) {
        if (error instanceof TransportError && cache) {
          const cached = await cache.read(plan, exec);
          if (cached.coverage !== "unknown") {
            debug.engine(
              "%s %s: offline - using %s local data",
              plan.op,
              plan.resource,
              cached.coverage,
            );
            return this.materialize(query, cached.data);
          }
        }
        throw error;
      }
    }

    if (cache) {
      return this.materialize(query, (await cache.read(plan, exec)).data);
    }

    throw new NoBackboneError(
      `No backbone can fulfill a read for "${plan.resource}". ` +
        `The cache declines this plan (mode "${this.registry.get(plan.resource).mode}") ` +
        `and this engine has no source for it.`,
    );
  }

  /**
   * Subscribe to a query (the non-React equivalent of `useSynced`):
   * local data immediately, background refresh, automatic updates
   * whenever related data changes.
   */
  watch<TResult>(input: QueryInput<TResult>): LiveQuery<TResult> {
    return new LiveQuery(toQuery(input), {
      cache: this.runtime.cache,
      store: this.queryStore,
      exec: this.runtime.exec,
    });
  }

  /**
   * Prefetch a [bundle](/docs/guides/bundles) of queries in one go,
   * warming the cache (and recording coverage) so the screen that
   * follows renders from local data. Resolves once every query has
   * synced; rejects if any of them fail. Cheap to call repeatedly -
   * queries already covered locally skip the network.
   */
  preload<TInput>(
    bundle: Bundle<TInput>,
    ...args: PreloadArgs<TInput>
  ): Promise<void> {
    const input = args[0] as TInput;
    debug.engine("preloading bundle");
    return Promise.all(
      bundle.build(input).map((query) => this.query(query)),
    ).then(() => undefined);
  }

  /**
   * Execute a write. The UI updates instantly; the promise resolves
   * with the server-confirmed result (after replay, if offline).
   */
  mutate<TResult>(plan: WritePlan<TResult>): Promise<TResult> {
    return this.pipeline.mutate(plan) as Promise<TResult>;
  }

  /** Writes still queued for the network (offline outbox depth). */
  get queuedWrites(): number {
    return this.pipeline.queuedCount;
  }

  /** Try to deliver queued writes now (also happens on backoff and `online`). */
  flushWrites(): Promise<void> {
    return this.pipeline.flush();
  }

  /** Force-refresh all active live queries. */
  refresh(): void {
    this.queryStore.refreshAll();
  }

  dispose(): void {
    this.pipeline.dispose();
    this.stopLive?.();
  }

  /** Resolve a raw read result: join includes, then apply refinements. */
  private async materialize<TResult>(
    query: Query<TResult>,
    raw: unknown,
  ): Promise<TResult> {
    if (query.shape !== "many") return (raw ?? null) as TResult;

    let rows = Array.isArray(raw) ? (raw as Row[]) : [];
    const includes = query.includes ?? [];
    if (includes.length > 0) {
      const related = new Map<string, Row[]>();
      for (const spec of includes) {
        const plan = childPlanFor(
          spec,
          query.plan.resource,
          rows,
          this.runtime.exec,
        );
        related.set(
          spec.key,
          plan ? ((await this.query({ plan, shape: "many" })) as Row[]) : [],
        );
      }
      rows = joinIncludes(
        query.plan.resource,
        rows,
        includes,
        related,
        this.runtime.exec,
      );
    }
    return applyRefinements(rows, query.refinements) as TResult;
  }
}

export function engine<const Resources extends readonly AnyResource[]>(
  config: EngineConfig<Resources>,
): Engine<Resources> {
  return new Engine(config);
}
