import { debug } from "../debug";
import { NoBackboneError, ResourceKitError, TransportError } from "../errors";
import type { WritePlan } from "../plan/write-plan";
import type { CacheBackbone, PendingMutation } from "./backbone";
import type { EngineRuntime } from "./engine.types";

/** An optimistic cache entry awaiting its authoritative outcome. */
type Optimistic = {
  cache: CacheBackbone;
  pending: PendingMutation;
};

type QueuedWrite = {
  plan: WritePlan;
  optimistic: Optimistic | null;
  attempts: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

const MAX_RETRY_DELAY = 30_000;
const noop = () => {};

/**
 * The write path: optimistic, then authoritative, then reconciled.
 *
 * 1. Queue the plan in the cache - visible state updates instantly.
 * 2. Send the plan to the source (stamped with the record's version
 *    when the resource declares one, for conflict detection).
 * 3. Confirmed → merge the canonical record. Rejected → drop the
 *    optimistic entry (visible state reverts by recomputation); a
 *    conflict additionally re-fetches the winning record.
 * 4. Network down → replayable writes stay queued and are retried with
 *    backoff (and on the browser's `online` event), in order, as one
 *    batched request.
 */
export class MutationPipeline {
  private replayQueue: QueuedWrite[] = [];
  private replayTimer: ReturnType<typeof setTimeout> | null = null;
  private currentFlush: Promise<void> | null = null;
  private turn: Promise<void> = Promise.resolve();
  private readonly outstanding = new Map<string, number>();
  private readonly onOnline = () => void this.flush();

  constructor(private readonly deps: EngineRuntime) {
    if (typeof window !== "undefined" && "addEventListener" in window) {
      window.addEventListener("online", this.onOnline);
    }
  }

  async mutate(plan: WritePlan): Promise<unknown> {
    this.deps.exec.resources.get(plan.resource); // Fail fast on unknown resources.

    // Claim the record synchronously: only the first outstanding write
    // to a record carries a version stamp - later ones build on it, and
    // the server bumps the version once per accepted write.
    const key = this.recordKey(plan);
    const isFirstWrite =
      key !== null &&
      (this.outstanding.get(key) ?? 0) === 0 &&
      !this.replayQueue.some((entry) => this.recordKey(entry.plan) === key);
    if (key) this.bump(key, +1);

    // Writes start strictly in call order (stamping is async, so
    // without the turn gate a quick second write could overtake a
    // stamped first one). Only the start is serialized - deliveries
    // themselves run concurrently and batch into one request.
    const previous = this.turn;
    let release!: () => void;
    this.turn = new Promise((resolve) => (release = resolve));
    await previous;

    try {
      const stamped = isFirstWrite ? await this.withBaseVersion(plan) : plan;
      debug.writes(
        "%s %s%s",
        stamped.op,
        stamped.resource,
        "baseVersion" in stamped && stamped.baseVersion !== undefined
          ? ` (base v${stamped.baseVersion})`
          : "",
      );
      const result = this.deliver(stamped);
      if (key)
        result.then(() => this.bump(key, -1)).catch(() => this.bump(key, -1));
      return result;
    } finally {
      release();
    }
  }

  /** Writes still waiting for the network. */
  get queuedCount(): number {
    return this.replayQueue.length;
  }

  /**
   * Re-queue writes recovered from a persisted outbox (their optimistic
   * effect is already restored in the cache) and try to deliver them.
   */
  adopt(pending: PendingMutation[]): void {
    const { cache } = this.deps;
    if (pending.length === 0 || !cache) return;
    debug.writes("recovered %d write(s) from the last session", pending.length);
    const recovered = pending.map<QueuedWrite>((entry) => ({
      plan: entry.plan,
      optimistic: { cache, pending: entry },
      attempts: 0,
      resolve: noop,
      reject: noop,
    }));
    // Recovered writes are older than anything queued this session.
    this.replayQueue = [...recovered, ...this.replayQueue];
    void this.flush();
  }

  /** Try to deliver queued writes now (e.g. behind a "retry" button). */
  flush(): Promise<void> {
    if (!this.currentFlush) {
      this.currentFlush = this.runFlush().finally(() => {
        this.currentFlush = null;
      });
    }
    return this.currentFlush;
  }

  private async runFlush(): Promise<void> {
    const { source, exec } = this.deps;
    if (!source) return;
    while (this.replayQueue.length > 0) {
      // Fire the whole queue in one tick: the transport coalesces
      // same-tick plans into a single request, and the server applies
      // a batch in submission order - so this is one round trip.
      // Snapshot first: writes queued mid-flight wait for the next loop.
      const batch = [...this.replayQueue];
      debug.writes("replaying %d queued write(s)", batch.length);
      const results = await Promise.all(
        batch.map(async (entry) => {
          try {
            return {
              entry,
              outcome: {
                ok: true as const,
                canonical: await source.execute(entry.plan, exec),
              },
            };
          } catch (error) {
            return { entry, outcome: { ok: false as const, error } };
          }
        }),
      );

      let offlineAgain = false;
      for (const { entry, outcome } of results) {
        if (!outcome.ok && outcome.error instanceof TransportError) {
          entry.attempts += 1;
          offlineAgain = true;
          continue; // Stays queued for the next flush.
        }

        this.replayQueue = this.replayQueue.filter((e) => e !== entry);
        if (outcome.ok) {
          await this.confirm(entry.optimistic, outcome.canonical);
          entry.resolve(outcome.canonical);
        } else {
          await this.rejectWrite(entry.plan, entry.optimistic, outcome.error);
          entry.reject(outcome.error);
        }
      }

      if (offlineAgain) {
        const attempts = Math.max(
          ...this.replayQueue.map((entry) => entry.attempts),
        );
        const delay = Math.min(MAX_RETRY_DELAY, 1_000 * 2 ** attempts);
        debug.writes(
          "still offline - %d write(s) queued, retrying in %dms",
          this.replayQueue.length,
          delay,
        );
        this.scheduleReplay(delay);
        return;
      }
      // A fully delivered batch: loop again in case new writes were
      // queued while it was in flight.
    }
  }

  dispose(): void {
    if (this.replayTimer) clearTimeout(this.replayTimer);
    if (typeof window !== "undefined" && "removeEventListener" in window) {
      window.removeEventListener("online", this.onOnline);
    }
  }

  private async deliver(plan: WritePlan): Promise<unknown> {
    const { cache, source, exec } = this.deps;

    const optimistic = cache?.canFulfill(plan, exec)
      ? { cache, pending: await cache.enqueue(plan, exec) }
      : null;

    if (!source || !source.canFulfill(plan, exec)) {
      if (!optimistic) {
        throw new NoBackboneError(
          `No backbone can fulfill a write for "${plan.resource}". ` +
            `Register a source, or use a cacheable resource mode for local-only data.`,
        );
      }
      // Local-only engine: the cache is authoritative.
      await optimistic.cache.settle(
        optimistic.pending,
        { status: "confirmed", canonical: null },
        exec,
      );
      return this.readBack(plan, optimistic.cache);
    }

    // Writes queued behind a network failure must land first - queue
    // behind them instead of racing ahead out of order.
    if (this.replayQueue.length > 0 && this.isReplayable(plan)) {
      return this.enqueueReplay(plan, optimistic);
    }

    try {
      const canonical = await source.execute(plan, exec);
      debug.writes("%s %s: confirmed", plan.op, plan.resource);
      await this.confirm(optimistic, canonical);
      return canonical;
    } catch (error) {
      if (error instanceof TransportError && this.isReplayable(plan)) {
        debug.writes(
          "%s %s: offline - queued for replay",
          plan.op,
          plan.resource,
        );
        return this.enqueueReplay(plan, optimistic);
      }
      debug.writes("%s %s: rejected (%O)", plan.op, plan.resource, error);
      await this.rejectWrite(plan, optimistic, error);
      throw error;
    }
  }

  private async confirm(
    optimistic: Optimistic | null,
    canonical: unknown,
  ): Promise<void> {
    if (!optimistic) return;
    await optimistic.cache.settle(
      optimistic.pending,
      { status: "confirmed", canonical },
      this.deps.exec,
    );
  }

  private async rejectWrite(
    plan: WritePlan,
    optimistic: Optimistic | null,
    error: unknown,
  ): Promise<void> {
    if (optimistic) {
      await optimistic.cache.settle(
        optimistic.pending,
        { status: "rejected" },
        this.deps.exec,
      );
    }
    // After losing a conflict, fetch the winning record so the user
    // sees what they conflicted with.
    if (error instanceof ResourceKitError && error.code === "conflict") {
      debug.writes(
        "%s %s: conflict - fetching the winner",
        plan.op,
        plan.resource,
      );
      void this.refreshRecord(plan);
    }
  }

  private async refreshRecord(plan: WritePlan): Promise<void> {
    const { cache, source, exec } = this.deps;
    if (plan.op === "create" || !source) return;
    const read = {
      type: "read",
      resource: plan.resource,
      op: "one",
      id: plan.id,
    } as const;
    try {
      const fresh = await source.execute(read, exec);
      if (cache?.canFulfill(read, exec)) await cache.ingest(read, fresh, exec);
    } catch {
      // Best effort - the next refresh will catch up.
    }
  }

  /**
   * Stamp a patch or action with the version of the record it is based
   * on, read from the local cache (the last server-confirmed state).
   */
  private async withBaseVersion(plan: WritePlan): Promise<WritePlan> {
    if (plan.op !== "patch" && plan.op !== "action") return plan;
    const { cache, exec } = this.deps;
    const versionField = exec.resources.get(plan.resource).version;
    if (!versionField || !cache) return plan;

    const read = {
      type: "read",
      resource: plan.resource,
      op: "one",
      id: plan.id,
    } as const;
    if (!cache.canFulfill(read, exec)) return plan;
    const { data } = await cache.read(read, exec);
    const version = (data as Record<string, unknown> | null)?.[versionField];
    return typeof version === "number"
      ? { ...plan, baseVersion: version }
      : plan;
  }

  private recordKey(plan: WritePlan): string | null {
    return plan.op === "patch" || plan.op === "action"
      ? `${plan.resource}:${plan.id}`
      : null;
  }

  private bump(key: string, delta: number): void {
    const next = (this.outstanding.get(key) ?? 0) + delta;
    if (next <= 0) this.outstanding.delete(key);
    else this.outstanding.set(key, next);
  }

  private isReplayable(plan: WritePlan): boolean {
    if (plan.op !== "action") return true;
    const def = this.deps.exec.resources.get(plan.resource).actionDefs[
      plan.action
    ];
    return def?.options.offline ?? false;
  }

  private enqueueReplay(
    plan: WritePlan,
    optimistic: Optimistic | null,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.replayQueue.push({ plan, optimistic, attempts: 0, resolve, reject });
      this.scheduleReplay(1_000);
    });
  }

  private scheduleReplay(delay: number): void {
    if (this.replayTimer) return;
    this.replayTimer = setTimeout(() => {
      this.replayTimer = null;
      void this.flush();
    }, delay);
  }

  /** Resolve the visible record for a locally-confirmed write. */
  private async readBack(
    plan: WritePlan,
    cache: CacheBackbone,
  ): Promise<unknown> {
    if (plan.op === "delete") return null;
    const { exec } = this.deps;
    const id =
      plan.op === "create"
        ? exec.resources.idOf(plan.resource, plan.record)
        : plan.id;
    const result = await cache.read(
      { type: "read", resource: plan.resource, op: "one", id },
      exec,
    );
    return result.data;
  }
}
