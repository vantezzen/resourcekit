import { z } from "zod";

// A literal (number, string, etc)
export const LiteralFilterSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);
export type LiteralFilter = z.infer<typeof LiteralFilterSchema>;

// A contains filter
export const ContainsFilterSchema = z.object({
  contains: z.string(),
});
export type ContainsFilter = z.infer<typeof ContainsFilterSchema>;

export const FilterSchema = z.union([
  LiteralFilterSchema,
  ContainsFilterSchema,
]);
export type Filter = z.infer<typeof FilterSchema>;
