import { z } from "zod";
import { IdSchema, WhereFilterSchema } from "./filters";

/**
 * Read plans describe which records must be present: `one` addresses a
 * record by identity, `where` describes a set with the wire filter
 * language (optionally windowed to the top `limit` records by `order`),
 * and `named` invokes a named server query. Predicates, sorting, and
 * limits beyond the window are local refinements (see core/query.ts)
 * and never appear here.
 */

export const WireOrderSchema = z.object({
  field: z.string(),
  direction: z.enum(["asc", "desc"]),
});
export type WireOrder = z.infer<typeof WireOrderSchema>;

export const ReadOneSchema = z.object({
  type: z.literal("read"),
  resource: z.string(),
  op: z.literal("one"),
  id: IdSchema,
});
export type ReadOne = z.infer<typeof ReadOneSchema>;

export const ReadWhereSchema = z.object({
  type: z.literal("read"),
  resource: z.string(),
  op: z.literal("where"),
  filter: WhereFilterSchema,
  /** Window the synced set: the top `limit` records by `order`. */
  order: WireOrderSchema.optional(),
  limit: z.number().int().positive().optional(),
});
export type ReadWhere = z.infer<typeof ReadWhereSchema>;

export const ReadNamedSchema = z.object({
  type: z.literal("read"),
  resource: z.string(),
  op: z.literal("named"),
  name: z.string(),
  input: z.unknown().optional(),
});
export type ReadNamed = z.infer<typeof ReadNamedSchema>;

export const ReadPlanSchema = z.discriminatedUnion("op", [
  ReadOneSchema,
  ReadWhereSchema,
  ReadNamedSchema,
]);

type ReadPlanWire = z.infer<typeof ReadPlanSchema>;

/**
 * A read plan, optionally carrying its result type as a phantom so
 * inference flows from `resource.where(...)` through to `data`.
 * `one` produces `T | null`; `where` produces `T[]`.
 */
export type ReadPlan<TResult = unknown> = ReadPlanWire & {
  /** @internal Phantom result type - never set at runtime. */
  readonly __result?: TResult;
};
