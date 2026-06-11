import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReadPlan } from "../queries/read-plan";
import type { z } from "zod";
import { Engine } from "../core/engine";
import type { LiveQueryState } from "../core/live-query";

export const ResourceKitContext = createContext<Engine>(
  null as unknown as Engine,
);

export const ResourceKitProvider: React.FC<{
  engine: Engine;
  children: React.ReactNode;
}> = ({ engine, children }) => {
  return (
    <ResourceKitContext.Provider value={engine}>
      {children}
    </ResourceKitContext.Provider>
  );
};

export const useEngine = () => {
  const context = useContext(ResourceKitContext);
  if (!context) {
    throw new Error("useEngine must be used within a ResourceKitProvider");
  }
  return context;
};

/**
 * useSynced: Subscribe to a ReadPlan with stale-while-revalidate behavior.
 *
 * Flow:
 *   1. Create a LiveQuery via engine.query(plan)
 *   2. Subscribe to LiveQuery state changes
 *   3. Re-render on every state change (new data, status, coverage)
 *   4. Destroy LiveQuery on unmount
 *
 * Returns { data, status, coverage, isRefreshing }
 */
export function useSynced<T extends z.ZodType = z.ZodType>(
  plan: ReadPlan<T>,
): LiveQueryState<z.infer<T>> {
  const planMemo = useMemo(() => plan, [JSON.stringify(plan)]);

  const engine = useEngine();
  const [state, setState] = useState<LiveQueryState<z.infer<T>>>({
    data: null,
    status: "loading",
    coverage: "unknown",
    isRefreshing: false,
  });

  useEffect(() => {
    const liveQuery = engine.liveQuery(plan);
    const unsubscribe = liveQuery.subscribe(setState);

    return () => {
      unsubscribe();
      liveQuery.destroy();
    };
  }, [planMemo]);

  return state;
}

/**
 * useOne: Convenience hook for fetching a single resource by ID.
 */
export function useOne<T extends z.ZodType = z.ZodType>(
  resource: { one: (id: string) => ReadPlan<T> },
  id: string,
): LiveQueryState<z.infer<T>> {
  return useSynced<T>(resource.one(id));
}

/**
 * usePreload: Preload a bundle of queries for a screen or workflow.
 *
 * Flow:
 *   1. Resolve the bundle's preload function to get ReadPlans
 *   2. For each plan, trigger engine.query() to populate the LocalStore
 *   3. Track overall preload status
 */
export function usePreload(_bundle: unknown, _input: unknown) {
  return {
    status: "idle" as const,
  };
}
