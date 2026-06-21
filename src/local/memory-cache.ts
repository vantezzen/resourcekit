import {
  CacheBackbone,
  type CacheReadResult,
  type ExecutionContext,
  type MutationOutcome,
  type PendingMutation,
} from "../core/backbone";
import { wireOrderComparator } from "../core/query";
import { debug } from "../debug";
import { matchesFilter } from "../plan/filters";
import { planKey, type QueryPlan } from "../plan/plan";
import type { ReadPlan } from "../plan/read-plan";
import type { WritePlan } from "../plan/write-plan";
import { CoverageIndex } from "./coverage";
import type { StorageDriver } from "./storage.types";

type Row = Record<string, unknown>;
type Id = string | number;

const PERSIST_DEBOUNCE = 50;

/**
 * In-memory cache backbone: canonical snapshot + optimistic overlay.
 *
 * Server-confirmed records live in `canonical`; queued writes live in
 * the `outbox`. Visible state is always `overlay(outbox, canonical)`,
 * recomputed (and memoized) on change - confirming a mutation merges
 * canonical data, rejecting one just drops the outbox entry.
 *
 * With a `storage` driver the whole state - records, snapshots,
 * coverage, and the outbox - is written behind every change and loaded
 * on startup, so data survives reloads and queued offline writes are
 * replayed next session.
 *
 * Reads are O(records-per-resource); fine well into the tens of
 * thousands.
 */
export class MemoryCacheBackbone extends CacheBackbone {
  override readonly restored: Promise<PendingMutation[]>;

  private readonly canonical = new Map<string, Map<Id, Row>>();
  private readonly snapshots = new Map<string, unknown>();
  private readonly coverage = new CoverageIndex();
  private readonly overlayMemo = new Map<string, Map<Id, Row>>();
  private readonly storage: StorageDriver | null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: PendingMutation[] = [];
  private seq = 0;

  constructor(options: { storage?: StorageDriver | null } = {}) {
    super();
    this.storage = options.storage ?? null;
    this.restored = this.storage
      ? this.restore(this.storage)
      : Promise.resolve([]);
  }

  canFulfill(plan: QueryPlan, exec: ExecutionContext): boolean {
    if (!exec.resources.has(plan.resource)) return false;
    const { mode, actionDefs } = exec.resources.get(plan.resource);
    if (mode === "connection") return false;

    if (plan.type === "read") {
      if (plan.op === "named" || mode === "snapshot") return true;
      if (plan.op === "one") return true;
      return mode === "collection";
    }

    if (mode === "snapshot" || mode === "blob") return false;
    if (plan.op === "action") return plan.action in actionDefs;
    return true;
  }

  async read(plan: ReadPlan, exec: ExecutionContext): Promise<CacheReadResult> {
    const resource = exec.resources.get(plan.resource);

    if (plan.op === "named" || resource.mode === "snapshot") {
      const key = planKey(plan);
      const present = this.snapshots.has(key);
      return {
        data: present ? this.snapshots.get(key) : null,
        coverage: present ? "complete" : "unknown",
      };
    }

    const rows = this.overlaid(plan.resource, exec);

    if (plan.op === "one") {
      const row = rows.get(plan.id) ?? null;
      return { data: row, coverage: row ? "complete" : "unknown" };
    }

    let matched = [...rows.values()].filter((row) =>
      matchesFilter(row, plan.filter),
    );
    if (plan.order) matched = matched.sort(wireOrderComparator(plan.order));
    if (plan.limit !== undefined) matched = matched.slice(0, plan.limit);

    return {
      data: matched,
      // A windowed set is never provably complete - the window's edge
      // can always have moved on the server.
      coverage:
        plan.limit === undefined &&
        this.coverage.covers(plan.resource, plan.filter)
          ? "complete"
          : matched.length > 0
            ? "partial"
            : "unknown",
    };
  }

  async ingest(
    plan: ReadPlan,
    result: unknown,
    exec: ExecutionContext,
  ): Promise<void> {
    const resource = exec.resources.get(plan.resource);

    if (plan.op === "named" || resource.mode === "snapshot") {
      this.snapshots.set(planKey(plan), result);
      this.invalidate(plan.resource);
      return;
    }

    const table = this.table(plan.resource);

    if (plan.op === "one") {
      const row = (result ?? null) as Row | null;
      if (row === null) table.delete(plan.id);
      else table.set(exec.resources.idOf(plan.resource, row), row);
    } else if (Array.isArray(result)) {
      const incoming = result as Row[];
      // The source is authoritative for an unwindowed set: records that
      // matched the filter locally but are absent from the result were
      // deleted (or moved out of the set) on the server. A windowed
      // result says nothing about records beyond its window.
      if (plan.limit === undefined) {
        const incomingIds = new Set(
          incoming.map((row) => exec.resources.idOf(plan.resource, row)),
        );
        for (const [id, row] of table) {
          if (matchesFilter(row, plan.filter) && !incomingIds.has(id)) {
            table.delete(id);
          }
        }
        this.coverage.markCovered(plan.resource, plan.filter);
      }
      for (const row of incoming) {
        table.set(exec.resources.idOf(plan.resource, row), row);
      }
      debug.cache(
        "ingested %d %s record(s)%s",
        incoming.length,
        plan.resource,
        plan.limit === undefined ? " (set covered)" : " (windowed)",
      );
    }

    this.invalidate(plan.resource);
  }

  async enqueue(
    plan: WritePlan,
    _exec: ExecutionContext,
  ): Promise<PendingMutation> {
    const pending: PendingMutation = { seq: ++this.seq, plan };
    this.outbox.push(pending);
    this.invalidate(plan.resource);
    return pending;
  }

  async settle(
    pending: PendingMutation,
    outcome: MutationOutcome,
    exec: ExecutionContext,
  ): Promise<void> {
    this.outbox = this.outbox.filter((entry) => entry !== pending);
    if (outcome.status === "confirmed") {
      this.mergeCanonical(pending.plan, outcome.canonical, exec);
    }
    this.invalidate(pending.plan.resource);
  }

  private table(resource: string): Map<Id, Row> {
    let table = this.canonical.get(resource);
    if (!table) {
      table = new Map();
      this.canonical.set(resource, table);
    }
    return table;
  }

  /** Visible rows for a resource: canonical snapshot + outbox overlay. */
  private overlaid(resource: string, exec: ExecutionContext): Map<Id, Row> {
    const memo = this.overlayMemo.get(resource);
    if (memo) return memo;

    const rows = new Map(this.canonical.get(resource) ?? []);
    for (const { plan } of this.outbox) {
      if (plan.resource === resource) this.applyToRows(rows, plan, exec);
    }
    this.overlayMemo.set(resource, rows);
    return rows;
  }

  private applyToRows(
    rows: Map<Id, Row>,
    plan: WritePlan,
    exec: ExecutionContext,
  ): void {
    switch (plan.op) {
      case "create": {
        rows.set(exec.resources.idOf(plan.resource, plan.record), plan.record);
        return;
      }
      case "patch": {
        const current = rows.get(plan.id);
        if (current) rows.set(plan.id, { ...current, ...plan.patch });
        return;
      }
      case "delete": {
        rows.delete(plan.id);
        return;
      }
      case "action": {
        // Declarative actions lower against the current overlaid record;
        // opaque actions have no local effect until the server answers.
        const def = exec.resources.get(plan.resource).actionDefs[plan.action];
        const current = rows.get(plan.id);
        if (def?.run && current) {
          rows.set(plan.id, {
            ...current,
            ...def.run({ input: plan.input, record: current }),
          });
        }
        return;
      }
    }
  }

  private mergeCanonical(
    plan: WritePlan,
    canonical: unknown,
    exec: ExecutionContext,
  ): void {
    const table = this.table(plan.resource);
    const canonicalRow = this.asRow(plan.resource, canonical, exec);
    if (canonicalRow) {
      table.set(exec.resources.idOf(plan.resource, canonicalRow), canonicalRow);
      return;
    }
    // No canonical record (local-only engine, a delete, or a source
    // without RETURNING): apply the plan to the snapshot exactly like
    // the overlay would.
    this.applyToRows(table, plan, exec);
  }

  /** Treat a source result as a record only if it carries the identity field. */
  private asRow(
    resource: string,
    value: unknown,
    exec: ExecutionContext,
  ): Row | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Row;
    return row[exec.resources.get(resource).identity] !== undefined
      ? row
      : null;
  }

  private invalidate(resource: string): void {
    this.overlayMemo.delete(resource);
    this.notify(resource);
    this.schedulePersist();
  }

  private async restore(storage: StorageDriver): Promise<PendingMutation[]> {
    try {
      const state = await storage.load();
      if (!state) return [];

      this.seq = state.seq;
      for (const [resource, rows] of Object.entries(state.tables)) {
        this.canonical.set(resource, new Map(rows));
      }
      for (const [key, result] of Object.entries(state.snapshots)) {
        this.snapshots.set(key, result);
      }
      this.coverage.restore(state.coverage);
      this.outbox = state.outbox.map(({ seq, plan }) => ({ seq, plan }));

      const touched = new Set([
        ...this.canonical.keys(),
        ...this.outbox.map((entry) => entry.plan.resource),
      ]);
      for (const resource of touched) {
        this.overlayMemo.delete(resource);
        this.notify(resource);
      }
      debug.cache(
        "restored %d resource(s), %d snapshot(s), %d queued write(s)",
        this.canonical.size,
        this.snapshots.size,
        this.outbox.length,
      );
      return [...this.outbox];
    } catch (error) {
      debug.cache("restore failed, starting fresh: %O", error);
      return []; // Unreadable state: start fresh rather than crash.
    }
  }

  private schedulePersist(): void {
    if (!this.storage || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, PERSIST_DEBOUNCE);
  }

  private async persist(): Promise<void> {
    const storage = this.storage;
    if (!storage) return;
    try {
      await storage.save({
        version: 1,
        seq: this.seq,
        tables: Object.fromEntries(
          [...this.canonical].map(([resource, rows]) => [resource, [...rows]]),
        ),
        snapshots: Object.fromEntries(this.snapshots),
        outbox: this.outbox.map(({ seq, plan }) => ({ seq, plan })),
        coverage: this.coverage.snapshot(),
      });
    } catch (error) {
      // Persistence is best-effort; the in-memory state stays authoritative.
      debug.cache("persist failed: %O", error);
    }
  }
}

/** @internal Exposed for tests that need deterministic persistence timing. */
export const PERSIST_DEBOUNCE_MS = PERSIST_DEBOUNCE;
