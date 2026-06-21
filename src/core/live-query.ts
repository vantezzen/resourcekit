import { planKey } from "../plan/plan";
import type { CacheBackbone, Coverage, ExecutionContext } from "./backbone";
import { childPlanFor, joinIncludes } from "./include";
import type { LiveQueryState, LiveQueryStatus } from "./live-query.types";
import { applyRefinements } from "./query";
import type { Query, Refinements } from "./query.types";
import type { QueryStore, SyncChannel } from "./query-store";
import type { ChannelState } from "./query-store.types";

export type { LiveQueryState, LiveQueryStatus } from "./live-query.types";

type Row = Record<string, unknown>;

/**
 * A reactive read: cached data immediately, source refresh in the
 * background, re-emission whenever local state changes (mutations,
 * syncs, other queries ingesting overlapping data). Included relations
 * are synced through their own deduplicated channels and joined
 * locally on every recompute.
 *
 * Lifecycle is subscription-driven: the underlying sync channels are
 * acquired when the first listener attaches and released when the last
 * one detaches, so `useSyncExternalStore` drives it naturally and
 * StrictMode double-mounting is harmless.
 */
export class LiveQuery<TResult = unknown> {
  private readonly listeners = new Set<() => void>();
  private refinements: Refinements<any> | undefined;
  private current: LiveQueryState<TResult>;
  private channel: SyncChannel | null = null;
  private readonly childChannels = new Map<string, SyncChannel>();
  private unsubscribers: Array<() => void> = [];
  private recomputeQueued = false;

  constructor(
    private readonly query: Query<TResult>,
    private readonly deps: {
      cache: CacheBackbone | null;
      store: QueryStore;
      exec: ExecutionContext;
    },
  ) {
    this.refinements = query.refinements;
    this.current = {
      data: (query.shape === "many" ? [] : null) as TResult,
      status: "loading",
      coverage: "unknown",
      isRefreshing: false,
      error: null,
    };
  }

  /** Current state snapshot. Stable identity until something changes. */
  getState = (): LiveQueryState<TResult> => this.current;

  /** Subscribe to changes. The first subscriber activates the query. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.activate();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.deactivate();
    };
  };

  /**
   * Replace the local refinements (predicates close over fresh values
   * every render - React calls this to keep them current). Cheap: only
   * notifies when the refined result actually changes.
   */
  refine(refinements: Refinements<any> | undefined): void {
    this.refinements = refinements;
    this.scheduleRecompute();
  }

  private activate(): void {
    const { cache, store, exec } = this.deps;
    this.channel = store.acquire(this.query.plan);
    this.unsubscribers.push(
      this.channel.subscribe(() => this.scheduleRecompute()),
    );

    const resources = new Set([
      this.query.plan.resource,
      ...(this.query.includes ?? []).map((spec) => spec.relation.target().name),
    ]);
    if (cache) {
      for (const resource of resources) {
        this.unsubscribers.push(
          cache.subscribe(resource, () => this.scheduleRecompute()),
        );
      }
    }
    this.scheduleRecompute();
  }

  private deactivate(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
    if (this.channel) {
      this.deps.store.release(this.channel);
      this.channel = null;
    }
    for (const channel of this.childChannels.values()) {
      this.deps.store.release(channel);
    }
    this.childChannels.clear();
  }

  private scheduleRecompute(): void {
    if (this.recomputeQueued) return;
    this.recomputeQueued = true;
    queueMicrotask(() => {
      this.recomputeQueued = false;
      void this.recompute();
    });
  }

  private async recompute(): Promise<void> {
    const next = await this.computeState();
    if (this.statesEqual(this.current, next)) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }

  private async computeState(): Promise<LiveQueryState<TResult>> {
    const { plan, shape } = this.query;
    const { cache, exec } = this.deps;

    const cached = cache?.canFulfill(plan, exec)
      ? await cache.read(plan, exec)
      : null;
    const channel = this.channel?.state ?? null;

    const raw = cached ? cached.data : channel?.lastResult;
    let data: TResult;
    if (shape === "many") {
      let rows = Array.isArray(raw) ? (raw as Row[]) : [];
      rows = await this.withIncludes(rows);
      data = applyRefinements(rows, this.refinements) as TResult;
    } else {
      data = (raw ?? null) as TResult;
    }

    const coverage: Coverage =
      cached?.coverage ?? (channel?.lastSyncedAt ? "complete" : "unknown");
    const isRefreshing = channel?.isRefreshing ?? false;

    return {
      data,
      status: this.deriveStatus(coverage, isRefreshing, channel),
      coverage,
      isRefreshing,
      error: channel?.error ?? null,
    };
  }

  /** Sync and join included relations (no-op without `.include()`). */
  private async withIncludes(rows: Row[]): Promise<Row[]> {
    const includes = this.query.includes ?? [];
    if (includes.length === 0) return rows;

    const { cache, exec } = this.deps;
    const baseResource = this.query.plan.resource;
    const related = new Map<string, Row[]>();

    for (const spec of includes) {
      const plan = childPlanFor(spec, baseResource, rows, exec);
      this.ensureChildChannel(spec.key, plan);
      related.set(
        spec.key,
        plan && cache?.canFulfill(plan, exec)
          ? ((await cache.read(plan, exec)).data as Row[])
          : [],
      );
    }
    return joinIncludes(baseResource, rows, includes, related, exec);
  }

  /** Keep one deduplicated channel per include, following the base set. */
  private ensureChildChannel(
    key: string,
    plan: ReturnType<typeof childPlanFor>,
  ): void {
    if (this.channel === null) return; // Only while active.
    const existing = this.childChannels.get(key);
    if (existing && plan && existing.key === planKey(plan)) return;

    if (existing) {
      this.deps.store.release(existing);
      this.childChannels.delete(key);
    }
    if (plan) {
      this.childChannels.set(key, this.deps.store.acquire(plan));
    }
  }

  private deriveStatus(
    coverage: Coverage,
    isRefreshing: boolean,
    channel: ChannelState | null,
  ): LiveQueryStatus {
    if (channel && !channel.online) return "offline";
    // No source serves this plan - local data is all there is.
    if (this.channel && !this.channel.hasSource) return "fresh";
    if (
      !isRefreshing &&
      (channel?.lastSyncedAt != null || coverage === "complete")
    ) {
      return "fresh";
    }
    if (coverage === "unknown") return "loading";
    return "stale";
  }

  private statesEqual(
    a: LiveQueryState<TResult>,
    b: LiveQueryState<TResult>,
  ): boolean {
    if (
      a.status !== b.status ||
      a.coverage !== b.coverage ||
      a.isRefreshing !== b.isRefreshing ||
      a.error !== b.error
    ) {
      return false;
    }
    // Single records come straight from the cache as stable references.
    if (this.query.shape === "single") return a.data === b.data;

    const left = a.data as unknown[];
    const right = b.data as unknown[];
    if (left.length !== right.length) return false;

    // Plain rows keep their stable cache reference, so identity is both
    // correct and cheap. Joined rows are rebuilt every recompute (a fresh
    // object per row), so they have to be compared by value - otherwise
    // every recompute looks like a change and the query never settles.
    const compare = this.query.includes?.length
      ? deepEqual
      : (x: unknown, y: unknown) => x === y;
    return left.every((row, index) => compare(row, right[index]));
  }
}

/** Structural equality for plain record data (objects, arrays, scalars). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (a instanceof Date || b instanceof Date) {
    return (
      a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
    );
  }
  const aArray = Array.isArray(a);
  const bArray = Array.isArray(b);
  if (aArray || bArray) {
    if (!aArray || !bArray || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
    ),
  );
}
