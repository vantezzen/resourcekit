import type { z } from "zod";
import type { ReadPlan } from "../queries/read-plan";
import { Backbone, BackboneRole } from "../server";

export type LiveQueryStatus = "loading" | "fresh" | "stale" | "offline";
export type LiveQueryCoverage = "complete" | "partial" | "unknown";

export type LiveQueryState<T> = {
  data: T | null;
  status: LiveQueryStatus;
  coverage: LiveQueryCoverage;
  isRefreshing: boolean;
};

type LiveQueryListener<T> = (state: LiveQueryState<T>) => void;

/**
 * A reactive data subscription that keeps itself up to date.
 *
 * Returns cached data immediately when available, then refreshes
 * from the source in the background. Re-emits whenever the
 * underlying data changes (from background syncs or local mutations).
 */
export class LiveQuery<TSchema extends z.ZodType = z.ZodType> {
  readonly plan: ReadPlan<TSchema>;
  private backbones: Backbone[];
  private listeners = new Set<LiveQueryListener<z.infer<TSchema>>>();
  private unsubscribers: (() => void)[] = [];
  private state: LiveQueryState<z.infer<TSchema>> = {
    data: null,
    status: "loading",
    coverage: "unknown",
    isRefreshing: false,
  };

  constructor(plan: ReadPlan<TSchema>, backbones: Backbone[]) {
    this.plan = plan;
    this.backbones = backbones;
    this.initialize();
  }

  private findCaches() {
    return this.backbones.filter(
      (b) => b.role === BackboneRole.Cache && b.canFulfill(this.plan),
    );
  }

  private findSources() {
    return this.backbones.filter(
      (b) => b.role === BackboneRole.Source && b.canFulfill(this.plan),
    );
  }

  private async initialize() {
    const caches = this.findCaches();
    const sources = this.findSources();
    const allBackbones = [...caches, ...sources];

    // Subscribe to backbones that support it so we re-read
    // whenever data changes — from mutations, syncs, etc.
    for (const backbone of allBackbones) {
      if (backbone.canSubscribe()) {
        const unsub = backbone.subscribe(this.plan.resource, () =>
          this.requery(),
        );
        this.unsubscribers.push(unsub);
      }
    }

    if (sources.length > 0) {
      this.setState({ isRefreshing: true });
    }

    // Execute against all backbones concurrently.
    // Cache results arrive first (instant), source results refresh later.
    allBackbones.map(async (backbone) => {
      try {
        const data = await backbone.execute(this.plan);
        if (data !== null) {
          this.setState({
            data: data as z.infer<TSchema>,
            status: backbone.role === BackboneRole.Cache ? "stale" : "fresh",
            isRefreshing:
              backbone.role === BackboneRole.Source
                ? false
                : this.state.isRefreshing,
          });

          // Write source data into cache backbones so they stay in sync
          if (backbone.role === BackboneRole.Source) {
            for (const cache of caches) {
              cache.ingest(this.plan.resource, data as unknown[]);
            }
          }
        }
      } catch {
        if (backbone.role === BackboneRole.Source && this.state.data === null) {
          this.setState({ status: "offline", isRefreshing: false });
        }
      }
    });
  }

  /** Re-read from the first cache after a data change notification. */
  private async requery() {
    const caches = this.findCaches();
    for (const cache of caches) {
      try {
        const data = await cache.execute(this.plan);
        if (data !== null) {
          this.setState({ data: data as z.infer<TSchema>, status: "fresh" });
          return;
        }
      } catch {
        // Try next cache
      }
    }
  }

  private setState(partial: Partial<LiveQueryState<z.infer<TSchema>>>) {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: LiveQueryListener<z.infer<TSchema>>): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  /** Get current state snapshot. */
  getState(): LiveQueryState<z.infer<TSchema>> {
    return this.state;
  }

  /** Stop listening and clean up. */
  destroy() {
    for (const unsub of this.unsubscribers) unsub();
    this.unsubscribers = [];
    this.listeners.clear();
  }
}
