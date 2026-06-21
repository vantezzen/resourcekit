import { resourceServer } from "./data/server";

const server = Bun.serve({
  port: 5174,
  // The /sync/events SSE stream only sends a keepalive every 15s, longer
  // than Bun's default 10s idleTimeout — which would close the stream
  // before the first heartbeat and break live updates. 0 disables it, so
  // the long-lived event stream stays open.
  idleTimeout: 0,

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/sync" && req.method === "POST") {
      return resourceServer.POST(req);
    }

    if (url.pathname === "/sync/events") {
      return resourceServer.events(req);
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    if (url.pathname === "/") {
      return new Response("ResourceKit playground API");
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`ResourceKit playground API running on ${server.url}`);
