import type { WritePlan } from "../plan/write-plan";
import type { ResourceRegistry } from "./backbone";

export type ExecutionContext<TCtx = unknown> = {
  readonly resources: ResourceRegistry;
  /** Server context (db handles, auth, …). `undefined` on the client. */
  readonly ctx: TCtx;
};

export type Coverage = "complete" | "partial" | "unknown";

export type CacheReadResult = {
  data: unknown;
  coverage: Coverage;
};

/** A queued optimistic write awaiting its authoritative outcome. */
export type PendingMutation = {
  readonly seq: number;
  readonly plan: WritePlan;
};

export type MutationOutcome =
  | { status: "confirmed"; canonical: unknown }
  | { status: "rejected" };
