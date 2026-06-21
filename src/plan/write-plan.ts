import { z } from "zod";
import { IdSchema } from "./filters";

/**
 * Write plans carry intent, not derived effects: an action plan ships
 * the action name and input, and each side derives the patch from its
 * own current record - so stale local state never bakes a wrong patch
 * into the protocol.
 *
 * Every mutation addresses a single record by identity. Bulk writes
 * cannot be expressed; model them as explicit actions.
 */

const RecordSchema = z.record(z.string(), z.unknown());

export const WriteCreateSchema = z.object({
  type: z.literal("write"),
  resource: z.string(),
  op: z.literal("create"),
  record: RecordSchema,
});
export type WriteCreate = z.infer<typeof WriteCreateSchema>;

export const WritePatchSchema = z.object({
  type: z.literal("write"),
  resource: z.string(),
  op: z.literal("patch"),
  id: IdSchema,
  patch: RecordSchema,
  /** The record version this write was based on (optimistic concurrency). */
  baseVersion: z.number().optional(),
});
export type WritePatch = z.infer<typeof WritePatchSchema>;

export const WriteDeleteSchema = z.object({
  type: z.literal("write"),
  resource: z.string(),
  op: z.literal("delete"),
  id: IdSchema,
});
export type WriteDelete = z.infer<typeof WriteDeleteSchema>;

export const WriteActionSchema = z.object({
  type: z.literal("write"),
  resource: z.string(),
  op: z.literal("action"),
  action: z.string(),
  id: IdSchema,
  input: z.unknown().optional(),
  /** The record version this write was based on (optimistic concurrency). */
  baseVersion: z.number().optional(),
});
export type WriteAction = z.infer<typeof WriteActionSchema>;

export const WritePlanSchema = z.discriminatedUnion("op", [
  WriteCreateSchema,
  WritePatchSchema,
  WriteDeleteSchema,
  WriteActionSchema,
]);

type WritePlanWire = z.infer<typeof WritePlanSchema>;

/** A write plan with a phantom result type (the canonical record). */
export type WritePlan<TResult = unknown> = WritePlanWire & {
  /** @internal Phantom result type - never set at runtime. */
  readonly __result?: TResult;
};
