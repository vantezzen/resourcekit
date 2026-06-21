import type { StorageDriver } from "../local/storage.types";
import type { LiveConnector } from "../sync/live.types";
import type { Transport } from "../sync/transport.types";
import type { CacheBackbone, SourceBackbone } from "./backbone";
import type { ExecutionContext } from "./backbone.types";
import type { AnyResource } from "./resource.types";

export type EngineConfig<Resources extends readonly AnyResource[]> = {
  resources: Resources;
  /** Sync endpoint for the default transport (default: `"/sync"`). */
  endpoint?: string;
  /** Custom transport - auth headers, websockets, tests. Overrides `endpoint`. */
  transport?: Transport;
  /**
   * Persist the cache (records, coverage, queued offline writes) so it
   * survives reloads. Pass a name - `persist: "my-app"` - to use the
   * built-in IndexedDB storage (a no-op outside the browser), or a
   * custom `StorageDriver`. Applies to the default cache only.
   */
  persist?: string | StorageDriver;
  /**
   * Receive server change notifications and refresh affected queries.
   * Pass an events URL - `live: "/sync/events"` - to use the built-in
   * `EventSource` connector (mount `sync.events` on the server), or a
   * custom connector for websockets / your own pub/sub.
   */
  live?: string | LiveConnector;
  /** Local cache backbone. Defaults to in-memory; pass `null` to disable. */
  cache?: CacheBackbone | null;
  /** Authoritative source. Defaults to the sync transport; pass `null` for local-only. */
  source?: SourceBackbone | null;
  /**
   * How long a synced set stays fresh before live queries revalidate.
   * - `0` (default): revalidate on every mount - always-correct, chattier.
   * - a number (ms): revalidate at most that often - e.g. `30_000`.
   * - `"forever"`: never revalidate on mount - pair with `live`, where
   *   the server pushes invalidations instead.
   */
  staleTime?: number | "forever";
  /**
   * How long a fully released live query keeps its sync channel warm,
   * so quick unmount/remount cycles reuse state (ms, default 1000).
   */
  retention?: number;
};

/** The wired client runtime the engine shares with its internals. */
export type EngineRuntime = {
  readonly cache: CacheBackbone | null;
  readonly source: SourceBackbone | null;
  readonly exec: ExecutionContext;
};
