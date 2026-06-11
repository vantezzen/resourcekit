import { type Table, type InferSelectModel, eq, and, like } from "drizzle-orm";
import type { QueryPlan } from "../../queries/query-plan";
import type { Resource } from "../../core/resource.types";
import { Backbone, BackboneRole, type BackboneConfig } from "../../server";
import type { Filter } from "../../queries/filters";

/**
 * Minimal structural type for any Drizzle database instance.
 * Works with Postgres, SQLite, MySQL — any dialect.
 */
type DrizzleDb = {
  select(): { from(table: any): any };
  update(table: any): { set(values: any): { where(condition: any): any } };
  insert(table: any): { values(values: any): any };
  delete(table: any): { where(condition: any): any };
};

class DrizzleBackbone<
  TResource extends Resource,
  TTable extends Table,
> extends Backbone<TResource> {
  override role = BackboneRole.Source;
  private db: DrizzleDb;
  private table: TTable;

  constructor(
    resource: TResource,
    db: DrizzleDb,
    table: TTable,
    config: BackboneConfig = {},
  ) {
    super(config);
    this.resource = resource;
    this.db = db;
    this.table = table;
  }

  override canSubscribe(): boolean {
    return false;
  }

  async execute(plan: QueryPlan): Promise<unknown> {
    if (plan.type === "query" && plan.op === "where") {
      return this.db
        .select()
        .from(this.table)
        .where(this.buildFilter(this.table, plan.filter));
    } else if (plan.type === "query" && plan.op === "one") {
      const idCol = this.resource!.identity;
      return this.db
        .select()
        .from(this.table)
        .where(eq((this.table as any)[idCol], plan.id));
    } else if (plan.type === "mutation") {
      return this.db
        .update(this.table)
        .set(plan.patch)
        .where(this.buildFilter(this.table, plan.filter));
    } else if (plan.type === "action") {
      return await this.performAction(plan);
    }

    throw new Error("Unsupported plan in drizzleBackbone");
  }

  private buildFilter(table: TTable, filter: Record<string, Filter>): any {
    let condition: any = null;
    for (const [key, value] of Object.entries(filter)) {
      let clause = eq((table as any)[key], value);
      if (typeof value === "object" && value !== null && "contains" in value) {
        clause = like((table as any)[key], `%${value.contains}%`);
      }

      condition = condition ? and(condition, clause) : clause;
    }
    return condition;
  }
}

export function drizzleBackbone<
  TResource extends Resource,
  TTable extends Table,
>(resource: TResource, db: DrizzleDb, table: TTable): Backbone<TResource> {
  return new DrizzleBackbone(resource, db, table);
}
