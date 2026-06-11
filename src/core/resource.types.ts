import type { z } from "zod";
import type { ActionDefinition } from "./action.types";
import type { ReadPlan } from "../queries/read-plan";
import type { ActionPlan, WritePlan } from "../queries/write-plan";

export type WhereFilter<T> = {
  [K in keyof T]?: T[K] | { contains: string };
};

export type ResourceConfig<
  TSchema extends z.ZodType = z.ZodType,
  Actions extends Record<string, ActionDefinition> = {},
> = {
  /** The Zod schema for the resource */
  schema: TSchema;

  /** The identity field for the resource (default: "id") */
  identity?: string;

  /** Local storage configuration */
  local?: {
    mode?: "collection" | "document" | "snapshot" | "blob" | "connection";
  };

  /** Action configuration */
  actions?: Actions;
};

export type ActionFunctions<
  Actions extends Record<string, ActionDefinition> = {},
> = {
  [K in keyof Actions]: (
    input: z.infer<Actions[K]["input"]>,
  ) => Promise<ActionPlan>;
};

export type Resource<
  TName extends string = string,
  TSchema extends z.ZodType = z.ZodType,
  Actions extends Record<string, ActionDefinition> = {},
> = {
  name: TName;
  schema: TSchema;
  identity: string;
  one: (id: string) => ReadPlan<TSchema>;
  where: (filter: WhereFilter<z.infer<TSchema>>) => ReadPlan<TSchema>;
  local: {
    mode: "collection" | "document" | "snapshot" | "blob" | "connection";
  };
  actions: Record<string, ActionDefinition>;
  actionPlans: ActionFunctions<Actions>;
};
