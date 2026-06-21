import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { memoryBackbone } from "../adapters/memory";
import { testStack } from "../testing/harness";
import { resource } from "./resource";

/**
 * Capabilities: a resource only exposes the operations it `supports`.
 * Type-gating is the primary guard; the server is the runtime backstop
 * for plans a typed client could never have built.
 */

const CustomerSchema = z.object({ id: z.string(), name: z.string() });

// A partial backbone shape, like Stripe: look up and patch, nothing else.
const customers = resource("customers", {
  schema: CustomerSchema,
  mode: "document",
  supports: ["one", "update"],
});

function stack() {
  return testStack([customers], {
    ctx: async () => ({}),
    resources: {
      customers: {
        backbone: memoryBackbone({ seed: [{ id: "c1", name: "Ada" }] }),
        access: "public",
      },
    },
  });
}

describe("resource capabilities", () => {
  test("supports reflects the declared operations", () => {
    expect(customers.supports).toEqual(["one", "update"]);
  });

  test("a resource defaults to every operation", () => {
    const things = resource("things", { schema: z.object({ id: z.string() }) });
    expect(things.supports).toEqual([
      "one",
      "where",
      "create",
      "update",
      "delete",
    ]);
  });

  test("the typed surface omits unsupported methods", () => {
    customers.one("c1");
    customers.update("c1", { name: "Ada L" });
    // @ts-expect-error - `where` is not supported, so it isn't a property
    customers.where;
    // @ts-expect-error - `create` is not supported, so it isn't a property
    customers.create;
    // @ts-expect-error - `delete` is not supported, so it isn't a property
    customers.delete;
  });

  test("the server rejects an unsupported operation", async () => {
    const { server } = stack();
    // A hand-built create plan - a typed client couldn't express it.
    const create = server.handlePlan(
      {
        type: "write",
        resource: "customers",
        op: "create",
        record: { id: "c2", name: "Grace" },
      },
      {},
    );
    await expect(create).rejects.toMatchObject({ code: "unsupported" });
  });

  test("a supported operation still goes through", async () => {
    const { server } = stack();
    const patched = await server.handlePlan(
      {
        type: "write",
        resource: "customers",
        op: "patch",
        id: "c1",
        patch: { name: "Ada Lovelace" },
      },
      {},
    );
    expect(patched).toMatchObject({ id: "c1", name: "Ada Lovelace" });
  });
});
