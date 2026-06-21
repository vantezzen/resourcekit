import { debug } from "../debug";
import { ResourceKitError, TransportError } from "../errors";
import { planKey } from "../plan/plan";
import type { ReadPlan } from "../plan/read-plan";
import type { EngineRuntime } from "./engine.types";
import type { ChannelState } from "./query-store.types";

export type { ChannelState } from "./query-store.types";

/**
 * One channel per sync key. All live queries that share a sync key -
 * however different their local refinements - share one channel, so the
 * expensive part (the network, the coverage bookkeeping) happens once.
 */
export class SyncChannel {
  refCount = 0;
  gcTimer: ReturnType<typeof setTimeout> | null = null;

  private current: ChannelState = {
    isRefreshing: false,
    lastSyncedAt: null,
    online: true,
    lastResult: undefined,
    error: null,
  };
  private readonly listeners = new Set<() => void>();

  constructor(
    readonly key: string,
    readonly plan: ReadPlan,
    private readonly deps: EngineRuntime,
  ) {}

  get state(): ChannelState {
    return this.current;
  }

  get hasSource(): boolean {
    const { source, exec } = this.deps;
    return source !== null && source.canFulfill(this.plan, exec);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Refresh unless a refresh is in flight or the last one is still fresh. */
  ensureFresh(staleTime: number): void {
    if (!this.hasSource || this.current.isRefreshing) return;
    if (
      this.current.lastSyncedAt !== null &&
      Date.now() - this.current.lastSyncedAt < staleTime
    ) {
      return;
    }
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const { source, cache, exec } = this.deps;
    if (!source || !source.canFulfill(this.plan, exec)) return;
    if (this.current.isRefreshing) return;

    debug.sync("refresh %s %s", this.plan.op, this.plan.resource);
    this.setState({ isRefreshing: true });
    try {
      const result = await source.execute(this.plan, exec);
      if (cache?.canFulfill(this.plan, exec)) {
        await cache.ingest(this.plan, result, exec);
      }
      this.setState({
        isRefreshing: false,
        lastSyncedAt: Date.now(),
        online: true,
        lastResult: result,
        error: null,
      });
    } catch (error) {
      if (error instanceof TransportError) {
        debug.sync("refresh %s: offline", this.plan.resource);
        this.setState({ isRefreshing: false, online: false });
      } else {
        this.setState({
          isRefreshing: false,
          online: true,
          error:
            error instanceof ResourceKitError
              ? error
              : new ResourceKitError("internal", String(error)),
        });
      }
    }
  }

  private setState(partial: Partial<ChannelState>): void {
    this.current = { ...this.current, ...partial };
    for (const listener of this.listeners) listener();
  }
}

/**
 * Deduplicates sync channels by plan key and keeps released channels
 * around briefly so quick unmount/remount cycles (StrictMode, route
 * transitions) reuse state instead of refetching.
 */
export class QueryStore {
  private readonly channels = new Map<string, SyncChannel>();

  constructor(
    private readonly deps: EngineRuntime & {
      staleTime: number;
      retention: number;
    },
  ) {}

  acquire(plan: ReadPlan): SyncChannel {
    const key = planKey(plan);
    let channel = this.channels.get(key);
    if (!channel) {
      channel = new SyncChannel(key, plan, this.deps);
      this.channels.set(key, channel);
    }
    channel.refCount += 1;
    if (channel.gcTimer) {
      clearTimeout(channel.gcTimer);
      channel.gcTimer = null;
    }
    channel.ensureFresh(this.deps.staleTime);
    return channel;
  }

  release(channel: SyncChannel): void {
    channel.refCount -= 1;
    if (channel.refCount > 0) return;
    channel.gcTimer = setTimeout(() => {
      if (channel.refCount <= 0) {
        this.channels.delete(channel.key);
      }
    }, this.deps.retention);
  }

  /** Force-refresh every active channel (e.g. after regaining focus). */
  refreshAll(): void {
    for (const channel of this.channels.values()) {
      void channel.refresh();
    }
  }

  /** Refresh the channels reading one resource (live-update reaction). */
  refreshResource(resource: string): void {
    for (const channel of this.channels.values()) {
      if (channel.plan.resource === resource) void channel.refresh();
    }
  }
}
