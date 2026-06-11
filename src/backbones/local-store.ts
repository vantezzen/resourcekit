import type { QueryPlan } from "../queries/query-plan";
import { Backbone, BackboneRole } from "../server";

/**
 * Client-side cache backed by IndexedDB.
 *
 * Returns cached data instantly on reads, applies optimistic updates
 * on writes, and emits change events so live queries re-read automatically.
 */
export class LocalStoreBackbone extends Backbone {
  override role = BackboneRole.Cache;

  async execute(_plan: QueryPlan): Promise<unknown> {
    // TODO: Read — query IndexedDB for cached records matching the plan
    // TODO: Write — apply optimistic mutation to IndexedDB, then notify()
    return null;
  }

  override ingest(resource: string, _records: unknown[]): void {
    // TODO: Write records into IndexedDB
    this.notify(resource);
  }
}
