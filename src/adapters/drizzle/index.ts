import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  type Column,
  type SQL,
  type Table,
} from "drizzle-orm";
import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { ResourceKitError } from "../../errors";
import type { FieldFilter, WhereFilter } from "../../plan/filters";
import type { QueryPlan } from "../../plan/plan";

/**
 * Minimal structural type for a Drizzle database with `returning`
 * support (Postgres or SQLite, any driver).
 */
type OrderedChain = PromiseLike<any[]> & {
  limit(n: number): PromiseLike<any[]>;
};
type FilteredChain = OrderedChain & {
  orderBy(...columns: SQL[]): OrderedChain;
};
type SelectChain = FilteredChain & {
  where(condition: SQL | undefined): FilteredChain;
};
type DrizzleDb = {
  select(): { from(table: Table): SelectChain };
  insert(table: Table): {
    values(values: unknown): { returning(): Promise<any[]> };
  };
  update(table: Table): {
    set(values: unknown): {
      where(condition: SQL | undefined): { returning(): Promise<any[]> };
    };
  };
  delete(table: Table): { where(condition: SQL | undefined): Promise<unknown> };
};

/**
 * Source backbone backed by a Drizzle table. Implements exactly the
 * five plan operations - the server runtime handles validation, access
 * scopes, action lowering, and named queries before plans get here.
 */
class DrizzleSourceBackbone extends SourceBackbone {
  constructor(
    private readonly db: DrizzleDb,
    private readonly table: Table,
  ) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    return plan.type === "read" ? plan.op !== "named" : plan.op !== "action";
  }

  async execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown> {
    const idColumn = this.column(exec.resources.get(plan.resource).identity);

    switch (plan.op) {
      case "one": {
        const rows = await this.db
          .select()
          .from(this.table)
          .where(eq(idColumn, plan.id));
        return rows[0] ?? null;
      }
      case "where": {
        const filtered = this.db
          .select()
          .from(this.table)
          .where(this.buildCondition(plan.filter));
        const ordered = plan.order
          ? filtered.orderBy(
              plan.order.direction === "desc"
                ? desc(this.column(plan.order.field))
                : asc(this.column(plan.order.field)),
            )
          : filtered;
        return plan.limit !== undefined ? ordered.limit(plan.limit) : ordered;
      }
      case "create": {
        const rows = await this.db
          .insert(this.table)
          .values(plan.record)
          .returning();
        return rows[0] ?? plan.record;
      }
      case "patch": {
        const rows = await this.db
          .update(this.table)
          .set(plan.patch)
          .where(eq(idColumn, plan.id))
          .returning();
        return rows[0] ?? null;
      }
      case "delete": {
        await this.db.delete(this.table).where(eq(idColumn, plan.id));
        return null;
      }
      case "named":
      case "action":
        throw new ResourceKitError(
          "internal",
          "Action and named-query plans must be resolved before reaching a source backbone.",
        );
    }
  }

  private buildCondition(filter: WhereFilter): SQL | undefined {
    const clauses: SQL[] = [];
    for (const [field, fieldFilter] of Object.entries(filter)) {
      clauses.push(...this.fieldClauses(this.column(field), fieldFilter));
    }
    return clauses.length > 0 ? and(...clauses) : undefined;
  }

  private fieldClauses(column: Column, filter: FieldFilter): SQL[] {
    if (filter === null) return [isNull(column)];
    if (typeof filter !== "object") return [eq(column, filter)];

    const clauses: SQL[] = [];
    if (filter.eq !== undefined) {
      clauses.push(filter.eq === null ? isNull(column) : eq(column, filter.eq));
    }
    if (filter.in !== undefined) clauses.push(inArray(column, filter.in));
    if (filter.gt !== undefined) clauses.push(gt(column, filter.gt));
    if (filter.gte !== undefined) clauses.push(gte(column, filter.gte));
    if (filter.lt !== undefined) clauses.push(lt(column, filter.lt));
    if (filter.lte !== undefined) clauses.push(lte(column, filter.lte));
    return clauses;
  }

  private column(name: string): Column {
    const column = getTableColumns(this.table)[name];
    if (!column) {
      throw new ResourceKitError(
        "internal",
        `Table has no column "${name}" - check the resource schema and identity.`,
      );
    }
    return column;
  }
}

export function drizzleBackbone(db: DrizzleDb, table: Table): SourceBackbone {
  return new DrizzleSourceBackbone(db, table);
}
