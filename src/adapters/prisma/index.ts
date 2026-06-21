import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { ResourceKitError } from "../../errors";
import type { FieldFilter, WhereFilter } from "../../plan/filters";
import type { QueryPlan } from "../../plan/plan";

type Row = Record<string, unknown>;
type PrismaWhere = Record<string, unknown>;

/**
 * Minimal structural view of a Prisma model delegate (e.g.
 * `prisma.task`). The adapter never imports `@prisma/client` - you pass
 * the delegate from your own generated client, so it stays typed and the
 * library stays dependency-free.
 */
export type PrismaDelegate = {
  findUnique(args: { where: PrismaWhere }): Promise<Row | null>;
  findMany(args: {
    where?: PrismaWhere;
    orderBy?: Record<string, "asc" | "desc">;
    take?: number;
  }): Promise<Row[]>;
  create(args: { data: Row }): Promise<Row>;
  update(args: { where: PrismaWhere; data: Row }): Promise<Row>;
  deleteMany(args: { where: PrismaWhere }): Promise<unknown>;
};

/**
 * Source backbone backed by a Prisma model. Reads and writes map onto
 * the delegate; the filter algebra becomes a Prisma `where`. Prisma
 * returns fully-typed values (booleans, dates), so nothing is coerced.
 */
class PrismaSourceBackbone extends SourceBackbone {
  constructor(private readonly delegate: PrismaDelegate) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    return plan.type === "read" ? plan.op !== "named" : plan.op !== "action";
  }

  async execute(plan: QueryPlan, exec: ExecutionContext): Promise<unknown> {
    const identity = exec.resources.get(plan.resource).identity;

    switch (plan.op) {
      case "one":
        return (
          (await this.delegate.findUnique({ where: { [identity]: plan.id } })) ??
          null
        );
      case "where":
        return this.delegate.findMany({
          where: buildWhere(plan.filter),
          orderBy: plan.order
            ? { [plan.order.field]: plan.order.direction }
            : undefined,
          take: plan.limit,
        });
      case "create":
        return this.delegate.create({ data: plan.record });
      case "patch": {
        if (Object.keys(plan.patch).length === 0) {
          return (
            (await this.delegate.findUnique({
              where: { [identity]: plan.id },
            })) ?? null
          );
        }
        try {
          return await this.delegate.update({
            where: { [identity]: plan.id },
            data: plan.patch,
          });
        } catch (error) {
          // Prisma throws P2025 when the record doesn't exist; the
          // contract wants a null, not a throw.
          if ((error as { code?: string }).code === "P2025") return null;
          throw error;
        }
      }
      case "delete":
        // deleteMany is idempotent - deleting a missing row is a no-op,
        // never an error.
        await this.delegate.deleteMany({ where: { [identity]: plan.id } });
        return null;
      case "named":
      case "action":
        throw new ResourceKitError(
          "internal",
          "Action and named-query plans must be resolved before reaching a source backbone.",
        );
    }
  }
}

/** Translate the filter algebra into a Prisma `where`. */
function buildWhere(filter: WhereFilter): PrismaWhere {
  const where: PrismaWhere = {};
  for (const [field, fieldFilter] of Object.entries(filter)) {
    where[field] = fieldCondition(fieldFilter);
  }
  return where;
}

function fieldCondition(filter: FieldFilter): unknown {
  if (filter === null || typeof filter !== "object") return filter;

  const cond: Record<string, unknown> = {};
  if (filter.eq !== undefined) cond.equals = filter.eq;
  if (filter.in !== undefined) cond.in = filter.in;
  if (filter.gt !== undefined) cond.gt = filter.gt;
  if (filter.gte !== undefined) cond.gte = filter.gte;
  if (filter.lt !== undefined) cond.lt = filter.lt;
  if (filter.lte !== undefined) cond.lte = filter.lte;
  return cond;
}

/**
 * A Prisma-backed source backbone for one model.
 *
 * @example
 * ```ts
 * import { PrismaClient } from "@prisma/client";
 * const prisma = new PrismaClient();
 * prismaBackbone(prisma.task);
 * ```
 */
export function prismaBackbone(delegate: PrismaDelegate): SourceBackbone {
  return new PrismaSourceBackbone(delegate);
}
