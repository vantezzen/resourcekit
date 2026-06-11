import { z } from "zod";
import { FilterSchema } from "./filters";

export const WriteOperations = ["mutation", "action"];

const MutationPatchSchema = z.object({
  type: z.literal("mutation"),
  resource: z.string(),
  op: z.literal("patch"),
  filter: z.record(z.string(), FilterSchema),
  patch: z.record(z.string(), z.unknown()),
  baseVersion: z.string(),
});
export type MutationPatch = z.infer<typeof MutationPatchSchema>;

const ActionPlanSchema = z.object({
  type: z.literal("action"),
  resource: z.string(),
  action: z.string(),
  input: z.unknown(),
  id: z.string().optional(),
});
export type ActionPlan = z.infer<typeof ActionPlanSchema>;

export const WritePlanSchema = z.discriminatedUnion("type", [
  MutationPatchSchema,
  ActionPlanSchema,
]);

type WritePlanBase = z.infer<typeof WritePlanSchema>;

/** WritePlan with a phantom TSchema for typed inference through the plan. */
export type WritePlan<TSchema extends z.ZodType = z.ZodType> = WritePlanBase & {
  readonly _schema?: TSchema;
};
