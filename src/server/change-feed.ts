import { debug } from "../debug";
import type { LiveChange } from "../sync/live.types";
import type { ChangeChannel } from "./channel.types";

/** A change as it travels between instances: tagged with its origin. */
type ChangeEnvelope = { origin: string; change: LiveChange };

/**
 * Every accepted write emits a change. The built-in `events` handler
 * streams changes to connected clients as Server-Sent Events; on
 * multi-instance deployments, call `syncVia` to fan changes out across
 * instances through Redis or any pub/sub.
 */
export class ChangeFeed {
  private readonly listeners = new Set<(change: LiveChange) => void>();
  /** Per-process id, so we ignore the echo of changes we published. */
  private readonly origin = crypto.randomUUID();
  /** True while re-emitting a remote change, so we don't republish it. */
  private relaying = false;

  subscribe(listener: (change: LiveChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(change: LiveChange): void {
    for (const listener of this.listeners) listener(change);
  }

  /**
   * Fan this feed out across server instances through a pub/sub
   * channel: changes here are published to the channel, and changes
   * from other instances are emitted here (so their SSE streams forward
   * them). Call once at startup; returns a stop function.
   *
   * @example
   * ```ts
   * import { redisChannel } from "resourcekit/server";
   * resourceServer.changes.syncVia(
   *   redisChannel({ publisher: pub, subscriber: sub }),
   * );
   * ```
   */
  syncVia(channel: ChangeChannel): () => void {
    const stopPublishing = this.subscribe((change) => {
      if (this.relaying) return; // don't republish what we just received
      void channel.publish(JSON.stringify({ origin: this.origin, change }));
    });

    const stopReceiving = channel.subscribe((message) => {
      const envelope = parseEnvelope(message);
      if (!envelope || envelope.origin === this.origin) return;
      debug.live(
        "relaying change from %s: %s",
        envelope.origin,
        envelope.change.resource,
      );
      this.relaying = true;
      try {
        this.emit(envelope.change);
      } finally {
        this.relaying = false;
      }
    });

    return () => {
      stopPublishing();
      stopReceiving();
    };
  }
}

function parseEnvelope(message: string): ChangeEnvelope | null {
  try {
    const parsed = JSON.parse(message) as ChangeEnvelope;
    return parsed && typeof parsed.origin === "string" && parsed.change
      ? parsed
      : null;
  } catch {
    return null;
  }
}

const HEARTBEAT_MS = 15_000;

/**
 * Stream a change feed as Server-Sent Events. Clients reconnect
 * automatically (`retry:` hint included), so platforms that cap
 * connection time - serverless hosts, proxies - just cause a brief gap.
 */
export function eventsResponse(feed: ChangeFeed, request: Request): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup();
        }
      };

      send("retry: 3000\n\n");
      const unsubscribe = feed.subscribe((change) =>
        send(`data: ${JSON.stringify(change)}\n\n`),
      );
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);

      cleanup = () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}
