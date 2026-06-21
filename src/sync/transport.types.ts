import type { SyncMessage, SyncResponse } from "./protocol";

/**
 * A transport delivers one sync message and returns the response.
 * It must throw `TransportError` for failures that are safe to retry
 * (network down, gateway errors) and never for "the server said no".
 */
export type Transport = (message: SyncMessage) => Promise<SyncResponse>;

export type FetchTransportOptions = {
  fetch?: typeof fetch;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
};
