# ResourceKit

**A full-stack data runtime for TypeScript apps.**

Define resources like `issues`, `projects`, `customers`, or `files`, turn reads and actions into typed plans, and let an engine execute those plans against local caches, remote sync, Postgres, REST, S3, Stripe, ClickHouse, or custom server code.

ResourceKit is not a database, ORM, cache library, or hosted backend. It is a runtime that unifies typed backend resources into a single full-stack API, with a clear sync path to the server and a focus on incremental adoption.

## Goals

- Keep the developer's existing backend, database, ORM, auth, and hosting.
- Make app data feel local: cached reads return immediately, live queries refresh in the background, and writes can be applied optimistically.
- Support incremental adoption: start with one resource, then add actions, access rules, bundles, synced queries, or relationships only when needed.
- Use one sync endpoint for serializable plans instead of many resource-specific API routes.
- Support multiple kinds of sources: Postgres, REST, S3, Stripe, ClickHouse, custom code.
- Avoid becoming a universal ORM. Query local projections, not arbitrary remote databases.

## Current shape

The current API is deliberately plan-first:

- A resource defines its schema, identity, local mode, queries, and typed actions.
- Calls such as `issues.where(...)`, `issues.one(...)`, and `issues.actionPlans.assign(...)` create serializable plans; they do not return active-record objects.
- An app-scoped engine owns the resources and exposes one-shot queries, live queries, mutations, and a server variant.
- React receives the engine through `ResourceKitProvider`; `useSynced(...)` and `useOne(...)` return `{ data, status, coverage, isRefreshing }`.
- Backbones are pluggable plan executors with either a cache or source role. The client uses local-cache and remote-sync backbones, while the server can use resource-specific backbones such as Drizzle.

Persistent IndexedDB storage, a durable offline outbox, reconciliation, policies, bundles, named synced queries, and relationships are the next layers of the design rather than requirements for the core API.

## Core concepts

- **Resource**: Typed, client-safe description of app data such as `issues`, `projects`, `customers`, or `files`.
- **Backbone**: Pluggable cache or source that declares which plans it can fulfill and executes them.
- **QueryPlan**: Serializable intermediate representation for reads and writes, created from calls like `issues.where(...)`, `issues.one(...)`, or a typed action-plan function.
- **Local store**: Client-side cache backbone intended to grow into a durable, queryable sync store.
- **Action**: Typed named operation that creates a write plan and can be implemented declaratively or by a server backbone.
  - **Custom server action**: Action that needs server-only business logic and must be implemented by a backbone.
  - **Named source operation**: Future extension for source-specific reads or writes such as `customers.byEmail(...)`, `files.byPrefix(...)`, or `reports.usageByWorkspace(...)`.
- **Policy / access rule**: Client-safe rule that enables fast frontend checks before queueing changes, while the server re-checks before committing.
- **Bundle**: Optional group of resource queries to preload for a screen or workflow, improving startup performance and offline completeness.
- **Coverage**: Metadata describing whether the local store has complete, partial, or unknown data for a query.
- **Synced query**: Named query or derived resource for complex reads such as search, aggregates, reports, joins, or external API data.
- **Relationship**: Optional metadata describing how resources connect, used for includes, preloading, and ergonomic APIs without implying arbitrary joins.
- **Resource mode**: Local behavior type for a resource, such as `collection`, `document`, `snapshot`, `blob`, or `connection`.
- **Mutation / outbox entry**: Durable queued write created from direct patches or actions, applied locally first and synced to the server later.
- **Reconciliation**: Process of merging server-accepted canonical data, rejected mutations, and local optimistic state.
- **Sync endpoint**: Single server endpoint that receives QueryPlans and mutations instead of many custom REST/RPC routes.
- **Engine**: App-scoped runtime that owns resources and routes plans through its configured backbones.
- **Stale-while-revalidate behavior**: Runtime behavior where local data is returned immediately while the server is refreshed in the background.
- **Declarative action**: Action that can be expressed as a patch or command and executed automatically by compatible backbones.
- **Derived resource**: Resource-like synced value backed by arbitrary server code, often cached locally as a snapshot.
- **Incremental adoption**: Usage model where developers start with one resource and add actions, policies, bundles, synced queries, and relationships only when needed.

### Resource

A resource is a typed, client-safe description of app data and a factory for plans.

The current contract contains its schema, identity, local storage mode, basic queries, and actions. Indexes, access rules, richer query capabilities, and relationships can be added without changing the plan-first model.

Examples: `issues`, `projects`, `customers`, `files`, `reports`.

### Backbone

A backbone is an execution target for plans.

Cache backbones provide local reads and optimistic updates. Source backbones provide authoritative data through remote sync, Drizzle/Postgres, REST, S3, Stripe, ClickHouse, or custom code.

Some backbones are universal, while others are attached to one resource. A Drizzle backbone can fulfill generic `where`, `one`, `patch`, and action plans for its resource; a future Stripe or S3 backbone may expose only named operations.

At its base, backbones answer two questions:

```tsx
backbone.canFulfill(plan);
backbone.execute(plan);
```

### QueryPlan

A QueryPlan is ResourceKit's intermediate representation for reads and writes.

User code like this:

```ts
issues.where({ workspaceId, title: { contains: search } });
```

becomes a serializable plan:

```ts
{
  type: "query",
  resource: "issues",
  op: "where",
  filter: {
    workspaceId: "w1",
    title: { contains: "hel" }
  }
}

// or

{
  type: "mutation",
  resource: "issues",
  op: "patch",
  filter: { id: "iss_1" },
  patch: { title: "Hello" },
  baseVersion: "v7"
}
```

A local store, remote transport, or server backbone can all answer the same question:

```ts
backbone.canFulfill(plan);
```

This keeps the runtime generic without forcing every source to behave like SQL.

### Local store

The local store is a cache backbone, not a full DBMS.

The current implementation establishes the cache interface and reactive update path. The durable version is intended to store:

- collection records
- document records
- snapshot results
- blob metadata/content
- pending mutations
- coverage metadata
- sync cursors and errors

The browser store is expected to use IndexedDB. Other stores, such as SQLite or React Native SQLite, can be added through the same backbone interface.

### Actions

Actions are typed resource operations that produce write plans.

Simple actions can be declarative and only defined once:

```ts
action(
  z.object({ userId: z.string() }),
  ({ userId }) => ({ assigneeId: userId }),
  { offline: true },
);
```

The resource exposes a typed plan function such as `issues.actionPlans.assign(...)`. The engine then executes the resulting plan through compatible backbones.

Custom actions can fall back to server-side code when business logic cannot be expressed as a patch or command.

If needed, actions can also be server-only:

```tsx
export const invoices = resource("invoices", {
  schema: InvoiceSchema,
  identity: "id",

  actions: {
    charge: action(z.object({ amount: z.number() }), null),
  },
});

const invoicesBackbone = customBackbone(invoices, {
  actions: {
    charge: async ({ id, input, ctx }) => {
      return ctx.billing.chargeInvoice(id, input.amount);
    },
  },
});
```

## Named source operations

Named source operations are the intended extension for resource operations that cannot or should not be expressed as generic `where`, `one`, `patch`, or `delete` plans.

They would be declared on the resource contract so TypeScript can expose them on the client and validate them on the server. A backbone would implement how the operation is fulfilled.

These operations are useful for:

- external APIs
- server-side search
- reports and aggregates
- source-specific operations
- complex joins
- business workflows
- anything that should not be modeled as generic filtering

They compile to QueryPlans or MutationPlans just like generic operations.

```ts
const customers = resource("customers", {
  schema: CustomerSchema,

  capabilities: {
    byEmail: query(
      z.object({
        email: z.string().email(),
      }),
      {
        result: z.array(CustomerSchema),
        local: "collection",
      },
    ),

    upcomingInvoices: query(
      z.object({
        customerId: z.string(),
      }),
      {
        result: z.array(InvoiceSchema),
        local: "snapshot",
      },
    ),

    bill: mutation(
      z.object({
        customerId: z.string(),
        amount: z.number(),
      }),
      {
        offline: false,
      },
    ),
  },
});

// or for pre-created templates:

import { stripeCustomerResource } from "resourcekit/stripe";
const customers = stripeCustomerResource();
```

The client gets typed methods from the capability declaration:

```tsx
const customer = useSynced(customers.byEmail({ email: "ada@example.com" }));

await customers.bill({
  customerId: "cus_123",
  amount: 5000,
});
```

Internally these become plans:

```ts
{
  type: "query",
  resource: "customers",
  op: "capability",
  name: "byEmail",
  input: { email: "ada@example.com" }
}

{
  type: "mutation",
  resource: "customers",
  op: "capability",
  name: "bill",
  input: {
    customerId: "cus_123",
    amount: 5000
  }
}
```

Implemented in the backbone:

```tsx
const customersBackbone = stripeBackbone(customers, {
  capabilities: {
    // These are already implemented via the internal stripeBackbone, no need to manually do so

    byEmail: async ({ input, ctx }) => {
      return ctx.stripe.customers.search({
        query: `email:"${input.email}"`,
      });
    },

    upcomingInvoices: async ({ input, ctx }) => {
      return ctx.stripe.invoices.list({
        customer: input.customerId,
        status: "upcoming",
      });
    },

    bill: async ({ input, ctx }) => {
      return ctx.stripe.paymentIntents.create({
        customer: input.customerId,
        amount: input.amount,
        currency: "usd",
      });
    },
  },
});
```

### Access rules

Access rules live on the resource contract so the client can check them before queueing a change.

The client uses access rules for fast UX. The server always re-checks before committing.

Server backbones can add stricter authoritative checks when access depends on server-only data.

### Bundles

Bundles are optional preload plans for screens or workflows.

They improve performance and offline completeness but are not required to use the library.

A bundle contains normal resource queries:

```ts
preload: ({ workspaceId }) => [
  issues.where({ workspaceId }),
  projects.where({ workspaceId }),
  members.where({ workspaceId }),
];
```

When a bundle syncs successfully, ResourceKit records coverage: the runtime knows that certain queries are complete locally.

### Synced queries and derived resources

For complex data, use named query capabilities or derived resources.

Examples:

- `reports.usageByWorkspace({ workspaceId, range })`
- `files.byPrefix({ prefix })`
- `issues.searchInWorkspace({ workspaceId, text })`
- `commentCounts.byWorkspace({ workspaceId })`

These can be backed by arbitrary server code and cached locally as collections or snapshots.

## Relationships

Relationships are optional metadata on a resource. They do not turn ResourceKit into an ORM and they do not imply arbitrary joins. They describe how resources connect so the runtime can expand includes, preload related data, maintain better local indexes, and expose ergonomic object APIs.

Simple relationships compile into additional `QueryPlan`s. Complex relationships should be modeled as custom synced queries.

```ts
export const comments = resource("comments", {
  schema: CommentSchema,

  local: {
    mode: "collection", // optional as this is the default
  },
});

export const projects = resource("projects", {
  schema: ProjectSchema,
});

export const issues = resource("issues", {
  schema: IssueSchema,

  relationships: ({ one, many }) => ({
    project: one(projects, {
      local: "projectId",
      foreign: "id",
    }),

    comments: many(comments, {
      local: "id",
      foreign: "issueId",
    }),
  }),
});
```

## Resource Modes

Not every resource behaves like a database table. A Postgres issue, a Stripe customer, a ClickHouse report, and an S3 file body need different local behavior.

- collection: individually stored records, queryable locally.
- document: one record by id, usually editable.
- snapshot: cached result of a named query or derived resource.
- blob: large content loaded on demand.
- connection: online-only resource with the same API shape but no offline promise.

Resources declare their local mode:

```ts
const issues = resource("issues", {
  schema: IssueSchema,
  local: {
    mode: "collection", // (default)
  },
});

const report = resource("usageReport", {
  schema: UsageReportSchema,
  local: {
    mode: "snapshot",
  },
});

const fileBody = resource("fileBody", {
  schema: z.object({
    key: z.string(),
    content: z.string(),
  }),
  identity: "key",
  local: {
    mode: "blob",
  },
});
```

## Runtime behavior

The core runtime is framework-agnostic. React integration is provided through `ResourceKitProvider`, `useSynced(...)`, and `useOne(...)`; other integrations can build on the same engine and live-query APIs.

`useSynced(...)` and other methods of accessing data are stale-while-revalidate by default:

1. Execute the QueryPlan against the local store immediately.
2. Return local data with freshness and coverage metadata.
3. If online, ask the remote/server backbone to refresh if it can fulfill the plan.
4. Merge returned data into the local store.
5. Re-render subscribers.

The mutation path is designed for local-first writes:

1. Validate input locally.
2. Apply an optimistic change through a cache backbone.
3. Send the same plan to a source backbone.
4. Accept canonical data or surface a rejection.
5. Reconcile the cache.

Durable outbox persistence, offline replay, and rollback are planned additions to this path.

Live queries expose state alongside their data:

- `status`: `"fresh" | "stale" | "offline" | "loading"`
- `coverage`: `"complete" | "partial" | "unknown"`
- `isRefreshing`

## Sync messages

The sync endpoint receives versioned batches of serializable plans, not arbitrary SQL or a separate route for every resource operation. The server engine validates the envelope, routes each plan to a compatible backbone, and returns per-plan results.

## One full example

```ts
// resources/issues.ts
import { z } from "zod";
import { action, engine, resource } from "resourcekit";

export const IssueSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  projectId: z.string(),
  title: z.string(),
  status: z.enum(["open", "closed"]),
  assigneeId: z.string().nullable(),
  updatedAt: z.string(),
});

export const issues = resource("issues", {
  schema: IssueSchema,
  local: {
    mode: "collection",
  },
  actions: {
    assign: action(z.object({ userId: z.string() }), ({ userId }) => ({
      assigneeId: userId,
    })),
  },
});

export const appData = engine({
  resources: [issues],
  endpoint: "/sync",
});
```

```ts
// server/sync.ts
import { appData, issues } from "../resources/issues";
import { drizzleBackbone } from "resourcekit/drizzle";
import { issuesTable } from "./db/schema";
import { db } from "./db";
import { getAuth } from "./auth";

export const syncServer = appData.server({
  ctx: async (req) => ({
    db,
    auth: await getAuth(req),
  }),

  backbones: [drizzleBackbone(issues, db, issuesTable)],
});

export const POST = syncServer.POST;
```

```tsx
// app/IssuePage.tsx
import { ResourceKitProvider, useOne, useSynced } from "resourcekit/react";
import { appData, issues } from "../resources/issues";

export function IssuePage({ issueId }: { issueId: string }) {
  const { data: issue, status } = useOne(issues, issueId);

  if (!issue) return <p>{status}</p>;
  return <h1>{issue.title}</h1>;
}

export function IssueSearch({
  workspaceId,
  search,
}: {
  workspaceId: string;
  search: string;
}) {
  const { data, status } = useSynced(
    issues.where({
      workspaceId,
      title: { contains: search },
    }),
  );

  return <pre>{JSON.stringify({ data, status }, null, 2)}</pre>;
}

export function App() {
  return (
    <ResourceKitProvider engine={appData}>
      <IssueSearch workspaceId="w1" search="" />
    </ResourceKitProvider>
  );
}
```

## Boundaries

ResourceKit should not try to solve every data problem.

- It does not run arbitrary client-provided SQL on the server.
- It does not replace the user's database, ORM, auth, or migrations.
- It does not guarantee complete offline search unless the relevant data has been synced or preloaded.
- It does not force all sources into one fake ORM model.

Instead, ResourceKit gives each resource clear capabilities and lets backbones declare what they can fulfill.

## Incremental adoption

Start small:

1. Define one resource and create an engine.
2. Register a source backbone on the server.
3. Provide the engine to the frontend and use `useOne` or `useSynced`.
4. Add typed actions and mutations when they make code clearer.
5. Add durable caching and offline behavior where the product needs it.
6. Add access rules, bundles, named synced queries, and relationships as those layers mature.

The goal is simple adoption with a path to deep capability.
