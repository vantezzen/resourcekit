import type { ResourceKitError } from "../errors";
import type { Coverage } from "./backbone.types";

export type LiveQueryStatus = "loading" | "fresh" | "stale" | "offline";

export type LiveQueryState<TResult> = {
  readonly data: TResult;
  readonly status: LiveQueryStatus;
  readonly coverage: Coverage;
  readonly isRefreshing: boolean;
  readonly error: ResourceKitError | null;
};
