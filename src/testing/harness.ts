import { engine, type Engine } from "../core/engine";
import type { EngineConfig } from "../core/engine.types";
import type { AnyResource } from "../core/resource.types";
import { TransportError } from "../errors";
import { server, type ServerConfig } from "../server";
import type { SyncResponse } from "../sync/protocol";
import type { Transport } from "../sync/transport.types";

/**
 * Test harness: a real `ResourceServer` reached through an in-process
 * transport with a toggleable network and a request counter. Each
 * `client()` is an independent engine (own cache), like a browser tab.
 */
export function testStack<const Resources extends readonly AnyResource[], TCtx>(
  resources: Resources,
  config: ServerConfig<Resources, TCtx>,
) {
  const stack = server(resources, config);
  const network = { online: true, requests: 0 };

  const transport: Transport = async (message) => {
    network.requests += 1;
    if (!network.online) throw new TransportError("Simulated offline.");
    const response = await stack.POST(
      new Request("http://test/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(message),
      }),
    );
    return (await response.json()) as SyncResponse;
  };

  const client = (
    overrides: Partial<EngineConfig<Resources>> = {},
  ): Engine<Resources> => engine({ resources, transport, ...overrides });

  return { server: stack, network, transport, client };
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
