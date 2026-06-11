import type { z } from "zod";
import type { ActionDefinition } from "./action.types";
import type { ReadPlan } from "../queries/read-plan";
import type { WritePlan } from "../queries/write-plan";
import type {
  ActionFunctions,
  Resource,
  ResourceConfig,
} from "./resource.types";

export function resource<
  TName extends string,
  TSchema extends z.ZodType,
  Actions extends Record<string, ActionDefinition> = {},
>(
  name: TName,
  config: ResourceConfig<TSchema, Actions>,
): Resource<TName, TSchema, Actions> {
  const actionPlans = {} as ActionFunctions<Actions>;
  for (const actionName in config.actions) {
    actionPlans[actionName] = async (input) => ({
      type: "action",
      resource: name,
      action: actionName,
      input,
    });
  }

  return {
    name,
    schema: config.schema,
    identity: config.identity ?? "id",
    local: {
      mode: config.local?.mode ?? "collection",
    },
    one: (id) => ({
      type: "query",
      resource: name,
      op: "one",
      id,
    }),
    where: (filter) => ({
      type: "query",
      resource: name,
      op: "where",
      filter,
    }),

    actions: config.actions ?? {},
    actionPlans,
  } as Resource<TName, TSchema, Actions>;
}
