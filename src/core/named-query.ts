import type { z } from "zod";
import type { NamedQueryDef } from "./named-query.types";

/**
 * Declare a named server query on a resource:
 *
 * ```ts
 * queries: {
 *   search: namedQuery(z.object({ text: z.string() }), z.array(IssueSchema)),
 * }
 * ```
 *
 * The server provides the implementation in its serve config; the
 * client gets a typed `issues.queries.search({ text })` that works with
 * `useSynced`, caching, and refresh like any other read.
 */
export function namedQuery<TInput extends z.ZodType, TOutput extends z.ZodType>(
  input: TInput,
  output: TOutput,
): NamedQueryDef<TInput, TOutput> {
  return { input, output };
}
