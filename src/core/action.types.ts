import type { z } from "zod";

export type ActionDefinition<
  TSchema extends z.ZodType = z.ZodType,
  TResult = unknown,
> = {
  input: TSchema;
  run?: (input: z.infer<TSchema>) => TResult;
  options?: {
    offline?: boolean;
  };
};
