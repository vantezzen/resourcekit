import { resourceServer } from "./resourcekit/server";

const server = Bun.serve({
  port: 5174,

  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/sync" && req.method === "POST") {
      return resourceServer.POST(req);
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
