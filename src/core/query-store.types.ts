import type { ResourceKitError } from "../errors";

export type ChannelState = {
  readonly isRefreshing: boolean;
  readonly lastSyncedAt: number | null;
  /** `false` after a transport failure, until a refresh succeeds. */
  readonly online: boolean;
  /** Last source result - the data path for cacheless (connection-mode) resources. */
  readonly lastResult: unknown;
  /** Last non-transport refresh error, if any. */
  readonly error: ResourceKitError | null;
};
