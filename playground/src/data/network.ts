import { useSyncExternalStore } from "react";

/**
 * Playground-only network simulation: a toggle to cut the connection
 * and a counter for sync requests, so the demo can show offline
 * queueing and which interactions never hit the network.
 */
export type NetworkState = {
  readonly offline: boolean;
  readonly requests: number;
};

let state: NetworkState = { offline: false, requests: 0 };
const listeners = new Set<() => void>();

function update(partial: Partial<NetworkState>) {
  state = { ...state, ...partial };
  for (const listener of listeners) listener();
}

export const network = {
  state: () => state,
  setOffline: (offline: boolean) => update({ offline }),
  countRequest: () => update({ requests: state.requests + 1 }),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export function useNetwork(): NetworkState {
  return useSyncExternalStore(network.subscribe, network.state);
}
