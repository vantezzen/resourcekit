import type { QueryInput } from "./query.types";

/**
 * A named group of queries to prefetch together for a screen or
 * workflow. Preloading a bundle warms the cache (and records coverage),
 * so the components that follow render from local data immediately.
 */
export type Bundle<TInput = void> = {
  readonly kind: "bundle";
  /** Resolve the bundle's queries for a given input. */
  readonly build: (input: TInput) => Array<QueryInput<unknown>>;
};

export type PreloadStatus = "loading" | "ready" | "error";

export type PreloadState = {
  readonly status: PreloadStatus;
  /** `true` once every query in the bundle is synced (or already local). */
  readonly ready: boolean;
  /** The first query that failed, if any. */
  readonly error: Error | null;
};

/**
 * The arguments that follow a bundle when preloading: an input, unless
 * the bundle takes none (then there's nothing more to pass).
 */
export type PreloadArgs<TInput> = [TInput] extends [void]
  ? []
  : [input: TInput];
