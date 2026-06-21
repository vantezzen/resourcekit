import { filterSubsumes, type WhereFilter } from "../plan/filters";

/**
 * Tracks which sets of records have been fully synced, per resource.
 *
 * Coverage is what lets a narrow query skip the network: if
 * `{ workspaceId: "w1" }` has been synced, then
 * `{ workspaceId: "w1", status: "open" }` is provably complete locally
 * (the local evaluator can do the narrowing). Subsumption uses the same
 * filter algebra that powers local matching and access scopes.
 */
export class CoverageIndex {
  private readonly covered = new Map<string, WhereFilter[]>();

  /** Is every record matching `filter` guaranteed to be local? */
  covers(resource: string, filter: WhereFilter): boolean {
    const entries = this.covered.get(resource) ?? [];
    return entries.some((entry) => filterSubsumes(entry, filter));
  }

  /** Record that the set matching `filter` has been fully synced. */
  markCovered(resource: string, filter: WhereFilter): void {
    if (this.covers(resource, filter)) return;
    const entries = this.covered.get(resource) ?? [];
    // Drop entries the new, wider set makes redundant.
    const kept = entries.filter((entry) => !filterSubsumes(filter, entry));
    kept.push(filter);
    this.covered.set(resource, kept);
  }

  /** Serializable form for persistence. */
  snapshot(): Record<string, WhereFilter[]> {
    return Object.fromEntries(this.covered);
  }

  restore(data: Record<string, WhereFilter[]>): void {
    for (const [resource, filters] of Object.entries(data)) {
      this.covered.set(resource, filters);
    }
  }
}
