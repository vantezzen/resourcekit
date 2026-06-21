import type { z } from "zod";

export type ActionLowering<TInput, TRecord, TPatch> = (args: {
  input: TInput;
  record: TRecord;
}) => TPatch;

export type ActionDefinition<
  TInput extends z.ZodType = z.ZodType,
  TPatch = unknown,
  TRun extends ActionLowering<any, any, TPatch> | null = ActionLowering<
    any,
    any,
    TPatch
  > | null,
> = {
  readonly input: TInput;
  readonly run: TRun;
  readonly options: {
    /**
     * Whether the action may be queued and replayed after a network
     * failure. Defaults to `true` for declarative actions (pure patches
     * are safe to replay) and `false` for opaque ones (replaying
     * "charge the customer" hours later is rarely what you want).
     */
    readonly offline: boolean;
  };
};

export type AnyActionDefinition = ActionDefinition<
  z.ZodType,
  Record<string, unknown>
>;

export type ActionOptions = { offline?: boolean };

/** Action names that have no declarative lowering and need a server implementation. */
export type OpaqueActionNames<
  TActions extends Record<string, AnyActionDefinition>,
> = {
  [K in keyof TActions]: TActions[K]["run"] extends null ? K : never;
}[keyof TActions];
