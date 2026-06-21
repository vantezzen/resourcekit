# resourcekit

## 1.0.0

### Initial stable release

**Full-stack data runtime for TypeScript.** Define your data once; ResourceKit adds instant local reads, optimistic writes with offline replay, live sync across clients, and typed end-to-end access control — on top of the database and server you already have.

#### Adapters

Built-in source backbones for every common storage tier, each taking a client you already have (no bundled drivers):

- **Drizzle** (`resourcekit/drizzle`) — Postgres, SQLite, MySQL via any Drizzle table
- **Prisma** (`resourcekit/prisma`) — any Prisma model delegate; filter algebra maps to Prisma `where`
- **MongoDB** (`resourcekit/mongo`) — document per record; filter maps to Mongo query operators
- **Redis** (`resourcekit/redis`) — JSON records at `<resource>:<id>`; works with `Bun.redis` or any `get/set/del/keys` client
- **bun:sqlite** (`resourcekit/sqlite`) — native SQLite via Bun, no Drizzle; Zod-driven boolean/date coercion
- **In-memory** (`resourcekit/memory`) — reference implementation; ideal for prototyping and tests
- **Stripe** (`resourcekit/stripe`) — partial backbone for Stripe API objects; typed per-object factories (`stripeCustomerBackbone`, `stripeSubscriptionBackbone`, `stripeProductBackbone`, `stripePriceBackbone`)

#### Stripe, in one line

Ready-made Zod schemas and resource factories in `resourcekit/stripe/resources` — no Stripe SDK import required in shared/client code:

```ts
import { stripeCustomerResource } from "resourcekit/stripe/resources";
export const customers = stripeCustomerResource();
// customers.one / customers.update are typed; customers.where doesn't exist
```

#### Capability typing (`supports`)

Resources declare which of the five operations they support. Unsupported operations are **absent from the type** — a compile error, never a runtime throw:

```ts
export const customers = resource("customers", {
  schema: CustomerSchema,
  supports: ["one", "update"], // no where, create, delete
});

customers.where({ ... }); // ✗ Property 'where' does not exist
```

The server enforces the same list as a runtime backstop with a new `unsupported` error code and `UnsupportedOperationError` class.

#### Conformance test suite

`resourcekit/testing` exports `sourceBackboneContract()` — 14 cases every adapter must pass, including no-match → `[]`, null filtering, and full canonical record return on create/patch. Run it against your own backbone to verify conformance.

#### Bug fix

`validatePatch` no longer injects Zod schema defaults into patches. This eliminated a bug where an offline create followed by an offline move would produce a duplicate "clone" record on reconnect.
