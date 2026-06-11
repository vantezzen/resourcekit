import type { z } from "zod";
import type { ActionDefinition } from "./action.types";

export function action<TSchema extends z.ZodType, TResult = unknown>(
  input: TSchema,
  run?: (input: z.infer<TSchema>) => TResult,
  options?: { offline?: boolean },
): ActionDefinition<TSchema, TResult> {
  return {
    input,
    run,
    options: {
      offline: options?.offline ?? false,
    },
  };
}
