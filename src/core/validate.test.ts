import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { validatePatch } from "./validate";

const schema = z.object({
  id: z.string().default(() => crypto.randomUUID()),
  title: z.string(),
  status: z.enum(["todo", "in_progress", "done"]).default("todo"),
  version: z.number().default(0),
  createdAt: z.string().default(() => new Date().toISOString()),
});

describe("validatePatch", () => {
  test("never injects defaults for omitted fields", () => {
    // `.partial()` alone would fill in id/version/createdAt defaults,
    // silently changing the record's identity on every edit.
    const patch = validatePatch(schema, { status: "in_progress" }, "patch");
    expect(patch).toEqual({ status: "in_progress" });
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("version");
    expect(patch).not.toHaveProperty("createdAt");
  });

  test("validates and keeps the fields the caller sent", () => {
    expect(validatePatch(schema, { title: "renamed" }, "patch")).toEqual({
      title: "renamed",
    });
  });

  test("strips unknown keys", () => {
    expect(
      validatePatch(schema, { title: "x", bogus: 1 } as any, "patch"),
    ).toEqual({ title: "x" });
  });

  test("rejects an invalid value for a provided field", () => {
    expect(() => validatePatch(schema, { title: 123 } as any, "patch")).toThrow();
  });

  test("non-object schemas pass through untouched", () => {
    const patch = { anything: true };
    expect(validatePatch(z.string() as any, patch, "patch")).toBe(patch);
  });
});
