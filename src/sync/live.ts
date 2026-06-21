import { debug } from "../debug";
import type { LiveChange, LiveConnector } from "./live.types";

export type { LiveChange, LiveConnector } from "./live.types";

/**
 * The default live connector: an `EventSource` against the server's
 * events endpoint. EventSource reconnects automatically, so hosts that
 * cut long connections (serverless platforms, proxies) just cause a
 * brief gap, not a failure. Outside the browser this is a no-op.
 */
export function eventSourceConnector(url: string): LiveConnector {
  return (onChange) => {
    if (typeof EventSource === "undefined") return () => {};
    const source = new EventSource(url);
    source.onopen = () => debug.live("connected to %s", url);
    source.onerror = () => debug.live("connection lost - reconnecting");
    source.onmessage = (event) => {
      try {
        onChange(JSON.parse(event.data as string) as LiveChange);
      } catch {
        // Ignore malformed events (e.g. proxies injecting comments).
      }
    };
    return () => {
      debug.live("disconnected from %s", url);
      source.close();
    };
  };
}
