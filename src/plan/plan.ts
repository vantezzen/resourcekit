import { z } from "zod";
import { ReadPlanSchema, type ReadPlan } from "./read-plan";
import { WritePlanSchema, type WritePlan } from "./write-plan";

/**
 * The plan IR is the sync protocol: every read and write becomes one of
 * these serializable shapes, and every backbone declares which shapes
 * it fulfills. Changes here affect clients and servers on different
 * versions - additions are fine, silent changes are not (see
 * plan.test.ts for the golden fixtures).
 */

export const QueryPlanSchema = z.union([ReadPlanSchema, WritePlanSchema]);

export type QueryPlan = ReadPlan | WritePlan;

export function isReadPlan(plan: QueryPlan): plan is ReadPlan {
  return plan.type === "read";
}

export function isWritePlan(plan: QueryPlan): plan is WritePlan {
  return plan.type === "write";
}

/**
 * Canonical cache key for a plan: a stable stringification with object
 * keys sorted, so structurally equal plans always share a key.
 */
export function planKey(plan: ReadPlan | WritePlan): string {
  return stableStringify(plan);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}
