import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { wireOrderComparator } from "../../core/query";
import { ResourceKitError } from "../../errors";
import { matchesFilter } from "../../plan/filters";
import type { QueryPlan } from "../../plan/plan";

type Row = Record<string, unknown>;
type Id = string | number;

export type MemoryBackboneOptions = {
  /** Initial records, applied to each resource this backbone serves. */
  seed?: Row[];
  /** Simulated latency in ms - handy for demoing optimistic UI. */
  latency?: number;
};

/**
 * In-memory source backbone: the reference implementation of the five
 * plan operations (`one`, `where`, `create`, `patch`, `delete`).
 * Action and named-query plans never reach a source backbone - the
 * server resolves them first. Useful for tests, demos, and prototyping
 * before a database exists.
 */
export class MemorySourceBackbone extends SourceBackbone {
  private readonly tables = new Map<string, Map<Id, Row>>();

  constructor(private readonly options: MemoryBackboneOptions = {}) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    return plan.type === "read" ? plan.op !== "named" : plan.op !== "action";
  }

  async execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown> {
    if (this.options.latency) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latency));
    }
    const rows = this.tableFor(plan.resource, exec);

    switch (plan.op) {
      case "one":
        return rows.get(plan.id) ?? null;
      case "where": {
        let matched = [...rows.values()].filter((row) =>
          matchesFilter(row, plan.filter),
        );
        if (plan.order) matched = matched.sort(wireOrderComparator(plan.order));
        if (plan.limit !== undefined) matched = matched.slice(0, plan.limit);
        return matched;
      }
      case "create": {
        rows.set(exec.resources.idOf(plan.resource, plan.record), plan.record);
        return plan.record;
      }
      case "patch": {
        const current = rows.get(plan.id);
        if (!current) return null;
        const next = { ...current, ...plan.patch };
        rows.set(plan.id, next);
        return next;
      }
      case "delete":
        rows.delete(plan.id);
        return null;
      case "named":
      case "action":
        throw new ResourceKitError(
          "internal",
          "Action and named-query plans must be resolved before reaching a source backbone.",
        );
    }
  }

  private tableFor(resource: string, exec: ExecutionContext): Map<Id, Row> {
    let table = this.tables.get(resource);
    if (!table) {
      table = new Map(
        (this.options.seed ?? []).map((row) => [
          exec.resources.idOf(resource, row),
          row,
        ]),
      );
      this.tables.set(resource, table);
    }
    return table;
  }
}

export function memoryBackbone(
  options?: MemoryBackboneOptions,
): MemorySourceBackbone {
  return new MemorySourceBackbone(options);
}
