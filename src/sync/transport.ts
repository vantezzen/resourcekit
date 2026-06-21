import { ResourceKitError, TransportError } from "../errors";
import { SyncResponseSchema } from "./protocol";
import type { FetchTransportOptions, Transport } from "./transport.types";

export type { FetchTransportOptions, Transport } from "./transport.types";

export function fetchTransport(
  endpoint: string,
  options: FetchTransportOptions = {},
): Transport {
  const doFetch = options.fetch ?? fetch;

  return async (message) => {
    const headers =
      typeof options.headers === "function"
        ? await options.headers()
        : options.headers;

    let response: Response;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...toHeaderRecord(headers),
        },
        body: JSON.stringify(message),
      });
    } catch (cause) {
      throw new TransportError(`Network request to ${endpoint} failed.`, cause);
    }

    if (response.status >= 500) {
      throw new TransportError(
        `Sync endpoint ${endpoint} answered ${response.status}.`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new TransportError(
        `Sync endpoint ${endpoint} returned a non-JSON response.`,
        cause,
      );
    }

    const parsed = SyncResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ResourceKitError(
        "internal",
        `Sync endpoint ${endpoint} returned an unrecognized response shape.`,
      );
    }
    return parsed.data;
  };
}

function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(new Headers(headers).entries());
}
