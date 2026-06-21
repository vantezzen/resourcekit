import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { Engine } from "../core/engine";
import type { Bundle, PreloadArgs, PreloadState } from "../core/bundle.types";
import type { LiveQueryState } from "../core/live-query.types";
import { toQuery } from "../core/query";
import type { Query, QueryInput } from "../core/query.types";
import { ResourceKitError } from "../errors";
import type { WritePlan } from "../plan/write-plan";
import { planKey } from "../plan/plan";

const ResourceKitContext = createContext<Engine | null>(null);

export const ResourceKitProvider: React.FC<{
  engine: Engine;
  children: React.ReactNode;
}> = ({ engine, children }) => (
  <ResourceKitContext.Provider value={engine}>
    {children}
  </ResourceKitContext.Provider>
);

export function useEngine(): Engine {
  const engine = useContext(ResourceKitContext);
  if (!engine) {
    throw new Error("useEngine must be used within a <ResourceKitProvider>.");
  }
  return engine;
}

/**
 * Subscribe to a query: local data instantly, refreshed in the
 * background, updated automatically after every mutation.
 *
 * `.filter() / .orderBy() / .limit()` run locally, so things like
 * search-as-you-type never hit the network. Components watching the
 * same data share one request.
 *
 * Returns `{ data, status, coverage, isRefreshing, error }`.
 */
export function useSynced<TResult>(
  input: QueryInput<TResult>,
): LiveQueryState<TResult> {
  const engine = useEngine();
  const query = toQuery(input);
  const key = planKey(query.plan);

  // Inert until subscribed, and keyed by the plan so changing local
  // refinements never recreates it or refetches.
  const live = useMemo(() => engine.watch(query), [engine, key]);

  // Predicates close over fresh render values - hand the latest ones to
  // the live query each render. No-op unless the refined result changes.
  useEffect(() => {
    live.refine(query.refinements);
  });

  return useSyncExternalStore(live.subscribe, live.getState, live.getState);
}

/** Subscribe to a single record by id. */
export function useOne<TResult>(
  resource: { one(id: any): Query<TResult> },
  id: string | number,
): LiveQueryState<TResult> {
  return useSynced(resource.one(id));
}

export type UseActionResult<TArgs extends unknown[], TResult> = {
  /** Run the write: the UI updates instantly, the promise resolves with the server's result. */
  run: (...args: TArgs) => Promise<TResult>;
  isPending: boolean;
  error: Error | null;
  /**
   * The last run lost to a concurrent edit. The optimistic change was
   * reverted and the winning record fetched - typical UI: "someone
   * else edited this, showing their version".
   */
  isConflict: boolean;
  reset: () => void;
};

/**
 * Run writes with pending/error state. Works with any resource write:
 * `issues.actions.assign`, `issues.create`, `issues.update`,
 * `issues.delete`. Pass the resource method itself (not an inline
 * arrow) so `run` stays stable across renders.
 *
 * @example
 * ```tsx
 * const assign = useAction(issues.actions.assign);
 * <button onClick={() => assign.run(issue.id, { userId })} />
 * ```
 */
export function useAction<TArgs extends unknown[], TResult>(
  factory: (...args: TArgs) => WritePlan<TResult>,
): UseActionResult<TArgs, TResult> {
  const engine = useEngine();
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState<Error | null>(null);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult> => {
      setPendingCount((count) => count + 1);
      setError(null);
      try {
        return await engine.mutate(factory(...args));
      } catch (caught) {
        const asError =
          caught instanceof Error ? caught : new Error(String(caught));
        setError(asError);
        throw asError;
      } finally {
        setPendingCount((count) => count - 1);
      }
    },
    [engine, factory],
  );

  return {
    run,
    isPending: pendingCount > 0,
    error,
    isConflict: error instanceof ResourceKitError && error.code === "conflict",
    reset: useCallback(() => setError(null), []),
  };
}

/** Fire writes directly, without tracking pending/error state. */
export function useMutate(): Engine["mutate"] {
  const engine = useEngine();
  return useCallback(
    <TResult,>(plan: WritePlan<TResult>) => engine.mutate(plan),
    [engine],
  );
}

/**
 * Prefetch a [bundle](/docs/guides/bundles) of queries when a screen
 * mounts, so the components inside it render from cache instead of
 * spinners. Re-runs when the input changes; cheap when the data is
 * already local.
 *
 * @example
 * ```tsx
 * function Workspace({ id }: { id: string }) {
 *   const { ready } = usePreload(workspaceData, { workspaceId: id });
 *   if (!ready) return <Skeleton />;
 *   return <Board workspaceId={id} />;
 * }
 * ```
 */
export function usePreload<TInput>(
  bundle: Bundle<TInput>,
  ...args: PreloadArgs<TInput>
): PreloadState {
  const engine = useEngine();
  const inputKey = JSON.stringify(args[0] ?? null);
  const [state, setState] = useState<PreloadState>({
    status: "loading",
    ready: false,
    error: null,
  });

  useEffect(() => {
    let active = true;
    setState({ status: "loading", ready: false, error: null });
    engine.preload(bundle, ...args).then(
      () => active && setState({ status: "ready", ready: true, error: null }),
      (caught: unknown) =>
        active &&
        setState({
          status: "error",
          ready: false,
          error: caught instanceof Error ? caught : new Error(String(caught)),
        }),
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, bundle, inputKey]);

  return state;
}
