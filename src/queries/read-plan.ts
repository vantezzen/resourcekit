import { z } from "zod";
import { FilterSchema } from "./filters";

export const ReadOperations = ["query", "synced-query"];

const QueryOneSchema = z.object({
  type: z.literal("query"),
  resource: z.string(),
  op: z.literal("one"),
  id: z.string(),
});

const QueryWhereSchema = z.object({
  type: z.literal("query"),
  resource: z.string(),
  op: z.literal("where"),
  filter: z.record(z.string(), FilterSchema),
});

const QuerySchema = z.discriminatedUnion("op", [
  QueryOneSchema,
  QueryWhereSchema,
]);

const SyncedQuerySchema = z.object({
  type: z.literal("synced-query"),
  resource: z.string(),
  query: z.string(),
  input: z.unknown(),
});

export const ReadPlanSchema = z.discriminatedUnion("type", [
  QuerySchema,
  SyncedQuerySchema,
]);

type ReadPlanBase = z.infer<typeof ReadPlanSchema>;

/** ReadPlan with a phantom TSchema for typed inference through the plan. */
export type ReadPlan<TSchema extends z.ZodType = z.ZodType> = ReadPlanBase & {
  readonly _schema?: TSchema;
};
