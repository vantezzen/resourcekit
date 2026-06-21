import type { z } from "zod";
import type {
  ActionDefinition,
  ActionLowering,
  ActionOptions,
  AnyActionDefinition,
} from "./action.types";

/**
 * Actions are typed, named write operations on a resource.
 *
 * A *declarative* action derives a patch from `(input, record)` -
 * applied instantly on the client, re-derived from canonical data on
 * the server. An *opaque* action passes `null` and is implemented in
 * the server config instead (e.g. `charge` calling Stripe).
 */

/** A declarative action: the patch is derived from `(input, record)`. */
export function action<TInput extends z.ZodType, TPatch>(
  input: TInput,
  run: ActionLowering<z.infer<TInput>, any, TPatch>,
  options?: ActionOptions,
): ActionDefinition<
  TInput,
  TPatch,
  ActionLowering<z.infer<TInput>, any, TPatch>
>;
/** An opaque action: implemented server-side in the serve config. */
export function action<TInput extends z.ZodType>(
  input: TInput,
  run: null,
  options?: ActionOptions,
): ActionDefinition<TInput, never, null>;
export function action(
  input: z.ZodType,
  run: ActionLowering<any, any, Record<string, unknown>> | null,
  options?: ActionOptions,
): AnyActionDefinition {
  return {
    input,
    run,
    options: {
      offline: options?.offline ?? run !== null,
    },
  };
}
