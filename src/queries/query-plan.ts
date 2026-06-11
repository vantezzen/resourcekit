import { z } from "zod";
import { ReadPlanSchema } from "./read-plan";
import { WritePlanSchema } from "./write-plan";

export type { ReadPlan } from "./read-plan";
export type { WritePlan } from "./write-plan";
export { ReadPlanSchema } from "./read-plan";
export { WritePlanSchema } from "./write-plan";

export const QueryPlanSchema = z.union([ReadPlanSchema, WritePlanSchema]);

type QueryPlanBase = z.infer<typeof QueryPlanSchema>;

/** Union of ReadPlan and WritePlan — used where either is accepted (e.g. backbone.execute). */
export type QueryPlan<TSchema extends z.ZodType = z.ZodType> = QueryPlanBase & {
  readonly _schema?: TSchema;
};
