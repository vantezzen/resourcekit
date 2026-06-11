import type { Backbone } from "../server";
import type { Resource } from "./resource.types";

export type ServerConfig<Resources extends readonly Resource[], TCtx> = {
  ctx: (req: Request) => Promise<TCtx>;
  backbones: Array<Backbone<Resources[number]>>;
};

/** Utility type to extract the inferred context type from a ctx resolver */
export type InferCtx<T extends (...args: any[]) => Promise<any>> = Awaited<
  ReturnType<T>
>;
