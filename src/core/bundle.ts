import type { QueryInput } from "./query.types";
import type { Bundle } from "./bundle.types";

/**
 * Declare a group of queries to prefetch together - typically the data
 * a whole screen needs. Preload it (via `engine.preload` or the
 * `usePreload` hook) and the queries sync in one go; the components that
 * render afterwards find their data already in the cache.
 *
 * @example
 * ```ts
 * export const workspaceData = bundle((workspaceId: string) => [
 *   issues.where({ workspaceId }),
 *   projects.where({ workspaceId }),
 *   members.where(),
 * ]);
 * ```
 *
 * A bundle with no input is fine too - `bundle(() => [...])`.
 */
export function bundle<TInput = void>(
  build: (input: TInput) => Array<QueryInput<unknown>>,
): Bundle<TInput> {
  return { kind: "bundle", build };
}
