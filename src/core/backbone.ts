import { UnknownResourceError } from "../errors";
import type { QueryPlan } from "../plan/plan";
import type { ReadPlan } from "../plan/read-plan";
import type { WritePlan } from "../plan/write-plan";
import type {
  CacheReadResult,
  ExecutionContext,
  MutationOutcome,
  PendingMutation,
} from "./backbone.types";
import type { AnyResource } from "./resource.types";

export type {
  CacheReadResult,
  Coverage,
  ExecutionContext,
  MutationOutcome,
  PendingMutation,
} from "./backbone.types";

/**
 * Backbones execute plans:
 *
 * - `SourceBackbone` - authoritative data (the sync transport on the
 *   client; Drizzle, memory, Stripe, S3 on the server).
 * - `CacheBackbone`  - local state: instant reads, optimistic overlay,
 *   coverage, change notifications.
 *
 * Backbones hold no per-request state; the resource registry and the
 * server `ctx` arrive through the `ExecutionContext`.
 */

export class ResourceRegistry {
  private readonly byName = new Map<string, AnyResource>();

  constructor(resources: readonly AnyResource[]) {
    for (const res of resources) {
      this.byName.set(res.name, res);
    }
  }

  get(name: string): AnyResource {
    const found = this.byName.get(name);
    if (!found) throw new UnknownResourceError(name, this.names());
    return found;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  /** Read the identity value of a record for a given resource. */
  idOf(resource: string, record: Record<string, unknown>): string | number {
    return record[this.get(resource).identity] as string | number;
  }
}

export abstract class SourceBackbone {
  /** Whether this backbone can fulfill the given plan. */
  abstract canFulfill(plan: QueryPlan, exec: ExecutionContext): boolean;

  /** Execute a plan against authoritative data and return its result. */
  abstract execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown>;
}

export abstract class CacheBackbone {
  private readonly listeners = new Map<string, Set<() => void>>();

  /**
   * Resolves once persisted state is loaded, with the writes that were
   * still queued when the last session ended (the engine re-queues
   * them). Caches without persistence resolve immediately with `[]`.
   */
  readonly restored: Promise<PendingMutation[]> = Promise.resolve([]);

  /** Whether this backbone can fulfill the given plan. */
  abstract canFulfill(plan: QueryPlan, exec: ExecutionContext): boolean;

  /** Read a plan against local state (canonical snapshot + optimistic overlay). */
  abstract read(
    plan: ReadPlan,
    exec: ExecutionContext,
  ): Promise<CacheReadResult>;

  /** Merge an authoritative read result into local state. */
  abstract ingest(
    plan: ReadPlan,
    result: unknown,
    exec: ExecutionContext,
  ): Promise<void>;

  /** Queue a write optimistically. Visible state updates immediately. */
  abstract enqueue(
    plan: WritePlan,
    exec: ExecutionContext,
  ): Promise<PendingMutation>;

  /**
   * Resolve a pending mutation. Confirmation merges the canonical
   * record; rejection simply drops the entry - visible state is always
   * recomputed as snapshot + remaining overlay, so there is no rollback
   * bookkeeping.
   */
  abstract settle(
    pending: PendingMutation,
    outcome: MutationOutcome,
    exec: ExecutionContext,
  ): Promise<void>;

  /** Subscribe to change notifications for one resource. */
  subscribe(resource: string, listener: () => void): () => void {
    let set = this.listeners.get(resource);
    if (!set) {
      set = new Set();
      this.listeners.set(resource, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  protected notify(resource: string): void {
    for (const listener of this.listeners.get(resource) ?? []) {
      listener();
    }
  }
}
