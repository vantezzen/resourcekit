import { z } from "zod";
import { InvalidInputError } from "../errors";

/** Parse with a schema, converting Zod failures into protocol-safe errors. */
export function validate<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  label: string,
): z.infer<TSchema> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InvalidInputError(`${label}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Validate a partial patch against a resource schema. Object schemas are
 * checked field-by-field (unknown keys are stripped); non-object schemas
 * pass through and rely on source-side validation.
 *
 * A patch must only ever carry the fields the caller actually sent.
 * `schema.partial()` makes every field optional but does *not* strip the
 * fields' `.default()`s, so parsing `{ status }` would inject fresh
 * defaults for every omitted field (a new `id`, a reset `version`, a new
 * `createdAt`) - silently changing the record's identity and clobbering
 * its metadata on every edit. So we validate, then keep only the keys the
 * patch already had.
 */
export function validatePatch(
  schema: z.ZodType,
  patch: Record<string, unknown>,
  label: string,
): Record<string, unknown> {
  if (schema instanceof z.ZodObject) {
    const validated = validate(schema.partial(), patch, label) as Record<
      string,
      unknown
    >;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) {
      // Unknown keys were stripped by the parse, so they stay out here too.
      if (key in validated) result[key] = validated[key];
    }
    return result;
  }
  return patch;
}
