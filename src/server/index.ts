import type { QueryPlan } from "../queries/query-plan";
import type { Resource } from "../core/resource.types";
import type { Engine } from "../core/engine";
import type { ActionPlan } from "../queries/write-plan";

export enum BackboneRole {
  /** Authoritative data source (e.g. Postgres via Drizzle, or the remote sync endpoint). */
  Source = "source",
  /** Local cache that provides instant reads and optimistic writes (e.g. IndexedDB). */
  Cache = "cache",
}

export type BackboneConfig = {
  actions?: Record<string, (input: unknown) => unknown>;
};

export abstract class Backbone<TResource extends Resource = Resource> {
  protected listeners = new Map<string, Set<() => void>>();

  /** Whether this backbone is the authoritative source or a local cache. */
  role: BackboneRole = BackboneRole.Source;

  /** The resource this backbone serves. Optional for universal backbones. */
  resource?: TResource;

  engine?: Engine;

  constructor(protected config: BackboneConfig = {}) {}

  /** Whether this backbone can fulfill the given plan. */
  canFulfill(plan: QueryPlan): boolean {
    return !this.resource || plan.resource === this.resource.name;
  }

  /** Execute a plan and return the result. */
  abstract execute(plan: QueryPlan): Promise<unknown>;

  canBatch(): boolean {
    return false;
  }

  executeBatch(_plans: QueryPlan[]): Promise<unknown[]> {
    throw new Error("Batch execution is not supported by this backbone");
  }

  /** Whether this backbone supports subscriptions for live queries. */
  canSubscribe(): boolean {
    return true;
  }

  /** Subscribe to data changes for a resource. */
  subscribe(resource: string, callback: () => void): () => void {
    if (!this.canSubscribe()) {
      throw new Error("This backbone does not support subscriptions");
    }

    if (!this.listeners.has(resource)) {
      this.listeners.set(resource, new Set());
    }
    this.listeners.get(resource)!.add(callback);
    return () => this.listeners.get(resource)?.delete(callback);
  }

  /** Write external data into this backbone (e.g. source writes into cache after a fetch). */
  ingest(_resource: string, _records: unknown[]): void {}

  /** Notify listeners that data for a resource has changed. */
  protected notify(resource: string) {
    const resourceListeners = this.listeners.get(resource);
    if (resourceListeners) {
      for (const listener of resourceListeners) {
        listener();
      }
    }
  }

  protected async performAction(plan: ActionPlan) {
    const resourceActions = this.engine?.resources[plan.resource]?.actions;
    const actionDef =
      this.config.actions?.[plan.action] ??
      resourceActions?.[plan.action as keyof typeof resourceActions]?.run;

    if (!actionDef) {
      throw new Error(
        `Action "${plan.action}" is not defined for resource "${this.resource!.name}"`,
      );
    }
    return await actionDef(plan.input);
  }
}
