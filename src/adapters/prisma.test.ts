import { describe, test } from "bun:test";
import { sourceBackboneContract } from "../testing/contract";
import { prismaBackbone, type PrismaDelegate } from "./prisma";

type Row = Record<string, unknown>;
type Cond = Record<string, unknown>;

/**
 * An in-memory Prisma model delegate. It interprets exactly the `where`
 * shapes the adapter builds, so the full contract exercises the adapter's
 * query translation and result handling against faithful Prisma semantics.
 */
function fakeDelegate(): PrismaDelegate {
  const rows = new Map<string, Row>();
  const idOf = (row: Row) => String(row.id);

  return {
    findUnique: async ({ where }) =>
      [...rows.values()].find((row) => matches(row, where)) ?? null,
    findMany: async ({ where, orderBy, take }) => {
      let out = [...rows.values()].filter((row) => matches(row, where ?? {}));
      if (orderBy) {
        const [field, dir] = Object.entries(orderBy)[0]!;
        out = [...out].sort(
          (a, b) => compare(a[field], b[field]) * (dir === "desc" ? -1 : 1),
        );
      }
      if (take !== undefined) out = out.slice(0, take);
      return out.map((row) => ({ ...row }));
    },
    create: async ({ data }) => {
      const row = { ...data };
      rows.set(idOf(row), row);
      return { ...row };
    },
    update: async ({ where, data }) => {
      const current = [...rows.values()].find((row) => matches(row, where));
      if (!current) {
        throw Object.assign(new Error("Record to update not found."), {
          code: "P2025",
        });
      }
      const next = { ...current, ...data };
      rows.set(idOf(next), next);
      return { ...next };
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const [key, row] of [...rows]) {
        if (matches(row, where)) {
          rows.delete(key);
          count += 1;
        }
      }
      return { count };
    },
  };
}

/** Evaluate a Prisma `where` (the subset the adapter emits) against a row. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([field, raw]) => {
    const value = row[field];
    if (raw === null) return value === null || value === undefined;
    if (typeof raw !== "object") return value === raw;

    const cond = raw as Cond;
    if ("equals" in cond) {
      if (cond.equals === null) return value === null || value === undefined;
      if (value !== cond.equals) return false;
    }
    if ("in" in cond && !(cond.in as unknown[]).includes(value)) return false;
    if ("gt" in cond && !((value as number) > (cond.gt as number))) return false;
    if ("gte" in cond && !((value as number) >= (cond.gte as number)))
      return false;
    if ("lt" in cond && !((value as number) < (cond.lt as number))) return false;
    if ("lte" in cond && !((value as number) <= (cond.lte as number)))
      return false;
    return true;
  });
}

function compare(a: unknown, b: unknown): number {
  if ((a as never) < (b as never)) return -1;
  if ((a as never) > (b as never)) return 1;
  return 0;
}

describe("prisma backbone fulfills the source contract", () => {
  for (const contractCase of sourceBackboneContract(async () => ({
    backbone: prismaBackbone(fakeDelegate()),
  }))) {
    test(contractCase.name, contractCase.run);
  }
});
