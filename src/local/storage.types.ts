import type { WhereFilter } from "../plan/filters";
import type { WritePlan } from "../plan/write-plan";

/** The cache's durable form - plain JSON, written behind every change. */
export type PersistedCache = {
  version: 1;
  seq: number;
  /** Canonical rows per resource, as `[id, row]` pairs. */
  tables: Record<string, [string | number, Record<string, unknown>][]>;
  /** Snapshot results by plan key. */
  snapshots: Record<string, unknown>;
  /** Queued writes that were never confirmed (replayed on next start). */
  outbox: { seq: number; plan: WritePlan }[];
  /** Fully synced sets per resource. */
  coverage: Record<string, WhereFilter[]>;
};

/**
 * Where the cache persists itself. One blob in, one blob out - drivers
 * stay trivial (IndexedDB ships built in; SQLite or file storage are a
 * dozen lines each).
 */
export type StorageDriver = {
  load(): Promise<PersistedCache | null>;
  save(state: PersistedCache): Promise<void>;
};
