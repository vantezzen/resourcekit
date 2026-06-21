import type { z } from "zod";
import type { CollectionQuery } from "./query";
import type { Query } from "./query.types";

/**
 * A named query is a typed, server-implemented read: search, reports,
 * aggregates, external APIs - anything the wire filter language
 * shouldn't try to express. Results are cached locally as snapshots
 * and refresh like any other query.
 */
export type NamedQueryDef<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> = {
  readonly input: TInput;
  readonly output: TOutput;
};

export type AnyNamedQueryDef = NamedQueryDef;

/** Array outputs are refinable collections; everything else is a single value. */
export type NamedQueryReturn<TDef extends AnyNamedQueryDef> =
  TDef["output"] extends z.ZodArray<infer TElement extends z.ZodType>
    ? CollectionQuery<z.output<TElement>>
    : Query<z.infer<TDef["output"]> | null>;

export type NamedQueryFactories<
  TQueries extends Record<string, AnyNamedQueryDef>,
> = {
  [K in keyof TQueries]: (
    input: z.infer<TQueries[K]["input"]>,
  ) => NamedQueryReturn<TQueries[K]>;
};
