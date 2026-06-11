import type { z } from "zod";
import type { ReadPlan } from "../queries/read-plan";
import type { WritePlan } from "../queries/write-plan";
import type { Resource } from "./resource.types";
import type { ServerConfig } from "./engine.types";
import { type Backbone, BackboneRole } from "../server";
import { LiveQuery } from "./live-query";
import { LocalStoreBackbone } from "../backbones/local-store";
import { RemoteSyncBackbone } from "../backbones/remote-sync";
import { handleSyncMessage } from "./server";

/**
 * The main entry point for ResourceKit.
 *
 * By default, creates a client-side engine with local caching and
 * background sync. Use `.server()` to create a server-side engine
 * for handling sync requests or server-rendering.
 *
 * @example
 * ```ts
 * const app = engine({ resources: [issues], endpoint: "/sync" });
 *
 * // Reactive query (React)
 * const state = useSynced(issues.where({ workspaceId }));
 *
 * // One-shot query (RSC / server)
 * const serverApp = app.server({ ctx, backbones: { ... } });
 * const data = await serverApp.query(issues.one("123"));
 * ```
 */
export class Engine<
  const Resources extends readonly Resource[] = readonly Resource[],
> {
  readonly resources: {
    [K in Resources[number]["name"]]: Extract<Resources[number], { name: K }>;
  } = {} as any;
  readonly endpoint: string;
  protected backbones: Backbone[] = [];

  constructor(config: {
    resources: Resources;
    endpoint?: string;
    /** @internal */
    backbones?: Backbone[];
  }) {
    this.resources = Object.fromEntries(
      config.resources.map((r) => [r.name, r]),
    ) as {
      [K in Resources[number]["name"]]: Extract<Resources[number], { name: K }>;
    };
    this.endpoint = config.endpoint ?? "/sync";
    const backbones = config.backbones ?? [
      new LocalStoreBackbone(),
      new RemoteSyncBackbone(this.endpoint),
    ];
    backbones.forEach((b) => this.addBackbone(b));
  }

  addBackbone(backbone: Backbone): void {
    this.backbones.push(backbone);
    backbone.engine = this;
  }

  /** Fetch data once and return the result. */
  async query<TSchema extends z.ZodType>(
    plan: ReadPlan<TSchema>,
  ): Promise<z.infer<TSchema>> {
    for (const backbone of this.backbones) {
      if (backbone.canFulfill(plan)) {
        return backbone.execute(plan) as Promise<z.infer<TSchema>>;
      }
    }
    throw new Error(
      `No backbone can fulfill plan for resource: ${plan.resource}`,
    );
  }

  /**
   * Subscribe to data that updates automatically.
   * Returns cached data immediately and refreshes from the source in the background.
   */
  liveQuery<TSchema extends z.ZodType>(
    plan: ReadPlan<TSchema>,
  ): LiveQuery<TSchema> {
    return new LiveQuery(plan, this.backbones);
  }

  /**
   * Execute a write operation (action or mutation).
   *
   * Runs against the cache first (optimistic update), then the source.
   * The cache notifies active live queries immediately so the UI updates
   * before the server confirms.
   */
  async mutate<TSchema extends z.ZodType>(
    plan: WritePlan<TSchema>,
  ): Promise<z.infer<TSchema>> {
    const cache = this.backbones.find(
      (b) => b.role === BackboneRole.Cache && b.canFulfill(plan),
    );
    const source = this.backbones.find(
      (b) => b.role === BackboneRole.Source && b.canFulfill(plan),
    );

    // 1. Apply optimistic update to cache immediately
    if (cache) {
      await cache.execute(plan);
    }

    // 2. Send to source for confirmation
    if (source) {
      const canonical = await source.execute(plan);
      // TODO: Write canonical result into cache (reconcile)
      // TODO: If source rejects, roll back the optimistic update in cache
      return canonical as z.infer<TSchema>;
    }

    if (!cache) {
      throw new Error(
        `No backbone can fulfill mutation for resource: ${plan.resource}`,
      );
    }

    return (await cache.execute(plan)) as z.infer<TSchema>;
  }

  /**
   * Create a server-side engine for handling sync requests or server-rendering.
   *
   * Returns a new engine configured with your database backbones, plus a
   * `POST` handler you can mount at your sync endpoint.
   *
   * @example
   * ```ts
   * const serverApp = app.server({
   *   ctx: async (req) => ({ db, auth: await getAuth(req) }),
   *   backbones: { issues: drizzleBackbone(issues, issuesTable) },
   * });
   *
   * // Mount the sync endpoint
   * export const POST = serverApp.POST;
   *
   * // Or use directly in RSC
   * const data = await serverApp.query(issues.where({ workspaceId }));
   * ```
   */
  server<TCtx>(
    serverConfig: ServerConfig<Resources, TCtx>,
  ): Engine<Resources> & { POST: (request: Request) => Promise<Response> } {
    const serverBackbones = Object.values(serverConfig.backbones) as Backbone[];

    const serverEngine = new Engine<Resources>({
      resources: Object.values(this.resources) as unknown as Resources,
      endpoint: this.endpoint,
      backbones: serverBackbones,
    });

    const POST = async (request: Request): Promise<Response> => {
      const _ctx = await serverConfig.ctx(request);

      return handleSyncMessage<TCtx>(serverEngine, request, _ctx);
    };

    return Object.assign(serverEngine, { POST });
  }
}

export function engine<const Resources extends readonly Resource[]>(config: {
  resources: Resources;
  endpoint?: string;
}): Engine<Resources> {
  return new Engine(config);
}
