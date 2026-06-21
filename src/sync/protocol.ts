import { z } from "zod";
import { QueryPlanSchema } from "../plan/plan";

/**
 * The sync protocol: one endpoint, versioned batches of plans in, one
 * result per plan out. No resource-specific routes, no client SQL.
 */

export const SyncMessageSchema = z.object({
  schemaVersion: z.literal("1"),
  plans: z.array(QueryPlanSchema),
});
export type SyncMessage = z.infer<typeof SyncMessageSchema>;

export const WireErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type WireError = z.infer<typeof WireErrorSchema>;

export const PlanResultSchema = z.union([
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), error: WireErrorSchema }),
]);
export type PlanResult = z.infer<typeof PlanResultSchema>;

export const SyncResponseSchema = z.union([
  z.object({ ok: z.literal(true), results: z.array(PlanResultSchema) }),
  z.object({ ok: z.literal(false), error: WireErrorSchema }),
]);
export type SyncResponse = z.infer<typeof SyncResponseSchema>;
