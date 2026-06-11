import { QueryPlanSchema } from "../queries/query-plan";
import { z } from "zod";

export const SyncMessageSchema = z.object({
  schemaVersion: z.literal("1"),
  plans: z.array(QueryPlanSchema),
});
export type SyncMessage = z.infer<typeof SyncMessageSchema>;

export const ServerErrorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});
export type ServerErrorResponse = z.infer<typeof ServerErrorResponseSchema>;

export const ServerSuccessResponseSchema = z.object({
  ok: z.literal(true),
  results: z.array(z.unknown()),
});
export type ServerSuccessResponse = z.infer<typeof ServerSuccessResponseSchema>;

export const ServerResponseSchema = z.union([
  ServerErrorResponseSchema,
  ServerSuccessResponseSchema,
]);
export type ServerResponse = z.infer<typeof ServerResponseSchema>;
