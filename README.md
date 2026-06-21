# ResourceKit

**A full-stack data runtime for TypeScript apps - instant to read, instant to write, synced for you.**

Building a screen usually means building plumbing: an API route per resource, loading spinners, cache invalidation, hand-rolled optimistic updates, handling for flaky networks. ResourceKit replaces that plumbing: You describe your data once - `issues`, `customers`, `files` - keep your existing database and backend, let the engine execute on Postgres, REST, S3, Stripe, ClickHouse, or custom server code and get:

- **Reads that feel local.** Queries answer from a local cache instantly and refresh in the background. Searching, sorting, and relation joins (`.include()`) run on data that's already there - no spinner per keystroke.
- **Writes that feel instant.** The UI updates immediately; the server confirms in the background. If the network is down, writes queue up and replay (as one batch) once you're back online.
- **Survives reloads and concurrent editors.** Opt into `persist: "my-app"` and the cache - queued offline writes included - comes back after a reload. Declare a `version` field and concurrent edits conflict cleanly instead of clobbering each other.
- **Live across windows.** Mount the SSE events endpoint and pass `live: "/sync/events"` - changes made elsewhere refresh affected queries automatically (reconnecting `EventSource`, so serverless-friendly).
- **A server that stays in charge.** On the server, your resources are backed by whatever actually holds the data - built-in adapters for Drizzle (Postgres/SQLite/MySQL), Prisma, MongoDB, Redis, `bun:sqlite`, and Stripe, plain server code, or your own - all behind the same typed interface. Stores that can't do everything declare what they `support`, and the unsupported operations vanish from the typed API.
- **One endpoint instead of many routes.** All reads, writes, and typed named queries (server-side search, reports) travel through a single `/sync` endpoint.

Here's the whole loop - describe data, serve it, use it - in three files:

```ts
// resources.ts - shared by client & server
import { z } from "zod";
import { resource, action, engine } from "resourcekit";

// 1. Describe your data with a Zod schema, plus any typed actions.
export const tasks = resource("tasks", {
  schema: z.object({
    id: z.string().default(() => crypto.randomUUID()),
    workspaceId: z.string(),
    title: z.string(),
    done: z.boolean().default(false),
    assigneeId: z.string().nullable(),
    updatedAt: z.string(),
  }),
  actions: {
    // Named, typed operations read better than ad-hoc field patches.
    assign: action(z.object({ userId: z.string().nullable() }), ({ input }) => ({
      assigneeId: input.userId,
    })),
  },
});

// 2. The engine is the shared contract both client and server build on.
//    On the client it owns the local cache; the server is created from
//    the same engine, so the two can never list different resources.
export const appEngine = engine({ resources: [tasks], endpoint: "/sync" });
```

```ts
// server.ts - server only
import { server } from "resourcekit/server";
import { drizzleBackbone } from "resourcekit/drizzle";
import { appEngine } from "./resources";
import { db, tasksTable } from "./db";
import { getAuth } from "./auth";

// 3. Build the server from the shared engine, then point each resource
//    at its data and declare who may see it.
const resourceServer = server(appEngine, {
  ctx: async (req) => ({ auth: await getAuth(req) }),
  resources: {
    tasks: {
      backbone: drizzleBackbone(db, tasksTable), // where the data lives
      access: (ctx) => ({ workspaceId: { in: ctx.auth.workspaceIds } }),
    },
  },
});

// One endpoint serves every resource - mount it on Next.js, Bun, Hono, …
export const POST = resourceServer.POST;
```

```tsx
// TaskList.tsx - client
import { useState } from "react";
import { ResourceKitProvider, useSynced, useAction } from "resourcekit/react";
import { appEngine, tasks } from "./resources";

export function App() {
  return (
    <ResourceKitProvider engine={appEngine}>
      <TaskList workspaceId="w1" />
    </ResourceKitProvider>
  );
}

function TaskList({ workspaceId }: { workspaceId: string }) {
  const [search, setSearch] = useState("");

  // 4. Reads are instant from the cache. .filter()/.orderBy() run locally
  //    on synced data, so typing here never hits the network.
  const { data: todo } = useSynced(
    tasks
      .where({ workspaceId, done: false })
      .filter((task) => task.title.includes(search))
      .orderBy("updatedAt", "desc"),
  );

  // 5. Writes apply optimistically; the server confirms in the background.
  const assign = useAction(tasks.actions.assign);

  return (
    <>
      <input value={search} onChange={(e) => setSearch(e.target.value)} />
      {todo.map((task) => (
        <button key={task.id} onClick={() => assign.run(task.id, { userId: "me" })}>
          {task.title}
        </button>
      ))}
    </>
  );
}
```

## Quick start

### 1. Describe your data (shared between client and server)

```ts
// resources.ts
import { z } from "zod";
import { action, engine, resource } from "resourcekit";

export const issues = resource("issues", {
  schema: z.object({
    id: z.string(),
    workspaceId: z.string(),
    title: z.string(),
    status: z.enum(["open", "closed"]),
    assigneeId: z.string().nullable(),
  }),
  actions: {
    assign: action(z.object({ userId: z.string() }), ({ input }) => ({
      assigneeId: input.userId,
    })),
  },
});

export const appData = engine({ resources: [issues], endpoint: "/sync" });
```

### 2. Serve it (server only)

```ts
// server/sync.ts
import { server } from "resourcekit/server";
import { drizzleBackbone } from "resourcekit/drizzle";
import { appData } from "../resources";

export const resourceServer = server(appData, {
  ctx: async (req) => ({ db, auth: await getAuth(req) }),
  resources: {
    issues: {
      backbone: drizzleBackbone(db, issuesTable),
      access: (ctx) => ({ workspaceId: { in: ctx.auth.workspaceIds } }),
    },
  },
});

export const POST = resourceServer.POST; // mount at /sync
```

You pass the server the same `appData` engine the client uses, so both sides share one source of truth for which resources exist. The `access` rule is declared once and enforced on every read and write - it's required, and a resource without one refuses all requests.

### 3. Use it (React)

```tsx
import { ResourceKitProvider, useSynced, useAction } from "resourcekit/react";
import { appData, issues } from "./resources";

// Declare your engine in the global provider once
<ResourceKitProvider engine={appData}>
  <App />
</ResourceKitProvider>;

function IssueList({ workspaceId }: { workspaceId: string }) {
  const { data, status } = useSynced(issues.where({ workspaceId }));
  // ...
}
```

It also works without React (`appData.watch(query).subscribe(...)`), as one-shot reads (`await appData.query(...)`), and on the server with the same query code (`resourceServer.session(ctx).query(...)` in RSC and loaders).

## Learn more

- **[TECH.md](./TECH.md)** - how it works inside: the plan protocol, the filter algebra, coverage, the optimistic write path, and how to write your own backbone.
- **[playground/](./playground)** - a runnable demo app (Vite + Bun) serving one typed API over Postgres (tasks), MongoDB (comments), and Redis (members).

## Development

```bash
bun install
bun test            # unit + integration + adapter contract tests
bun run typecheck   # library + playground
bun run build       # tsup → dist
bun run dev         # playground
```

Need to see what the runtime is doing? Everything logs through [`debug`](https://github.com/debug-js/debug):

```bash
DEBUG=resourcekit:* bun run dev          # server side
localStorage.debug = "resourcekit:*"     # browser console, then reload
```

Namespaces: `engine` (read routing), `cache`, `sync` (network), `writes`, `live`, `server`.

Conventions and contributor docs live in [TECH.md](./TECH.md). Releases use [changesets](https://github.com/changesets/changesets): `bunx changeset` with your PR.
