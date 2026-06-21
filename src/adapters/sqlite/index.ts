import { z } from "zod";
import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { ResourceKitError } from "../../errors";
import type { FieldFilter, WhereFilter } from "../../plan/filters";
import type { AnyResource } from "../../core/resource.types";
import type { QueryPlan } from "../../plan/plan";

/**
 * Minimal structural view of a `bun:sqlite` `Database`, so the adapter
 * never imports `bun:sqlite` itself - you pass your own instance and the
 * library stays dependency-free and bundler-agnostic.
 */
export type BunSqliteStatement = {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
};
export type BunSqliteDatabase = {
  query(sql: string): BunSqliteStatement;
};

type Row = Record<string, unknown>;

/**
 * Source backbone backed by a `bun:sqlite` table. Implements the five
 * plan operations directly in SQL (the server runtime resolves actions
 * and named queries before they reach here).
 *
 * SQLite has no native boolean or date type, so values round-trip
 * through the resource's Zod schema: booleans store as `0/1` and dates
 * as ISO strings on write, and the schema coerces them back on read.
 * Column names are the schema's field names.
 */
class SqliteSourceBackbone extends SourceBackbone {
  constructor(
    private readonly db: BunSqliteDatabase,
    private readonly table: string,
  ) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    return plan.type === "read" ? plan.op !== "named" : plan.op !== "action";
  }

  async execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown> {
    const resource = exec.resources.get(plan.resource);
    const table = ident(this.table);
    const idColumn = ident(resource.identity);

    switch (plan.op) {
      case "one": {
        const row = this.db
          .query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`)
          .get(plan.id) as Row | undefined;
        return row ? coerceRow(resource, row) : null;
      }
      case "where": {
        const { clause, params } = buildWhere(plan.filter);
        let sql = `SELECT * FROM ${table}${clause}`;
        if (plan.order) {
          sql += ` ORDER BY ${ident(plan.order.field)} ${
            plan.order.direction === "desc" ? "DESC" : "ASC"
          }`;
        }
        if (plan.limit !== undefined) sql += ` LIMIT ${Number(plan.limit)}`;
        const rows = this.db.query(sql).all(...params) as Row[];
        return rows.map((row) => coerceRow(resource, row));
      }
      case "create": {
        const columns = Object.keys(plan.record);
        const placeholders = columns.map(() => "?").join(", ");
        const values = columns.map((c) => toStored(plan.record[c]));
        const rows = this.db
          .query(
            `INSERT INTO ${table} (${columns.map(ident).join(", ")}) ` +
              `VALUES (${placeholders}) RETURNING *`,
          )
          .all(...values) as Row[];
        return coerceRow(resource, rows[0] ?? (plan.record as Row));
      }
      case "patch": {
        const columns = Object.keys(plan.patch);
        if (columns.length === 0) {
          const row = this.db
            .query(`SELECT * FROM ${table} WHERE ${idColumn} = ?`)
            .get(plan.id) as Row | undefined;
          return row ? coerceRow(resource, row) : null;
        }
        const assignments = columns.map((c) => `${ident(c)} = ?`).join(", ");
        const values = columns.map((c) => toStored(plan.patch[c]));
        const rows = this.db
          .query(
            `UPDATE ${table} SET ${assignments} ` +
              `WHERE ${idColumn} = ? RETURNING *`,
          )
          .all(...values, plan.id) as Row[];
        return rows[0] ? coerceRow(resource, rows[0]) : null;
      }
      case "delete": {
        this.db
          .query(`DELETE FROM ${table} WHERE ${idColumn} = ?`)
          .run(plan.id);
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
}

/** Build a parameterized `WHERE` clause from the filter algebra. */
function buildWhere(filter: WhereFilter): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  for (const [field, fieldFilter] of Object.entries(filter)) {
    const column = ident(field);
    for (const part of fieldClauses(column, fieldFilter)) {
      clauses.push(part.sql);
      params.push(...part.params);
    }
  }

  return clauses.length > 0
    ? { clause: ` WHERE ${clauses.join(" AND ")}`, params }
    : { clause: "", params };
}

function fieldClauses(
  column: string,
  filter: FieldFilter,
): { sql: string; params: unknown[] }[] {
  if (filter === null) return [{ sql: `${column} IS NULL`, params: [] }];
  if (typeof filter !== "object") {
    return [{ sql: `${column} = ?`, params: [toStored(filter)] }];
  }

  const out: { sql: string; params: unknown[] }[] = [];
  if (filter.eq !== undefined) {
    out.push(
      filter.eq === null
        ? { sql: `${column} IS NULL`, params: [] }
        : { sql: `${column} = ?`, params: [toStored(filter.eq)] },
    );
  }
  if (filter.in !== undefined) {
    // An empty `IN ()` is a syntax error in SQLite and matches nothing.
    if (filter.in.length === 0) out.push({ sql: "0 = 1", params: [] });
    else
      out.push({
        sql: `${column} IN (${filter.in.map(() => "?").join(", ")})`,
        params: filter.in.map(toStored),
      });
  }
  if (filter.gt !== undefined)
    out.push({ sql: `${column} > ?`, params: [toStored(filter.gt)] });
  if (filter.gte !== undefined)
    out.push({ sql: `${column} >= ?`, params: [toStored(filter.gte)] });
  if (filter.lt !== undefined)
    out.push({ sql: `${column} < ?`, params: [toStored(filter.lt)] });
  if (filter.lte !== undefined)
    out.push({ sql: `${column} <= ?`, params: [toStored(filter.lte)] });
  return out;
}

/** Convert a JS value to its SQLite storage form (no native bool/date). */
function toStored(value: unknown): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Coerce a raw SQLite row back to JS types, guided by the resource schema. */
function coerceRow(resource: AnyResource, row: Row): Row {
  const shape = objectShape(resource.schema);
  if (!shape) return row;

  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value === null ? null : coerceField(shape[key], value);
  }
  return out;
}

function coerceField(field: z.ZodType | undefined, value: unknown): unknown {
  if (!field) return value;
  const base = baseType(field);
  if (base instanceof z.ZodBoolean) return Boolean(value);
  if (base instanceof z.ZodNumber) return Number(value);
  if (base instanceof z.ZodDate) return new Date(value as string);
  return value;
}

function objectShape(
  schema: z.ZodType,
): Record<string, z.ZodType> | null {
  return schema instanceof z.ZodObject
    ? (schema.shape as Record<string, z.ZodType>)
    : null;
}

/** Unwrap optional/nullable/default wrappers to the underlying type. */
function baseType(type: z.ZodType): z.ZodType {
  // `any` to step through Zod's wrapper chain without fighting its
  // internal generics; every wrapper exposes `.unwrap()`.
  let current: any = type;
  while (
    current instanceof z.ZodOptional ||
    current instanceof z.ZodNullable ||
    current instanceof z.ZodDefault
  ) {
    current = current.unwrap();
  }
  return current as z.ZodType;
}

/** Quote a SQL identifier, rejecting anything that isn't a plain name. */
function ident(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new ResourceKitError(
      "internal",
      `Unsafe SQL identifier "${name}" - table and column names must be plain identifiers.`,
    );
  }
  return `"${name}"`;
}

/**
 * A `bun:sqlite`-backed source backbone for one table. Pass a `Database`
 * and the table name; column names must match the resource's fields.
 *
 * @example
 * ```ts
 * import { Database } from "bun:sqlite";
 * const db = new Database("app.db");
 * sqliteBackbone(db, "tasks");
 * ```
 */
export function sqliteBackbone(
  db: BunSqliteDatabase,
  table: string,
): SourceBackbone {
  return new SqliteSourceBackbone(db, table);
}
