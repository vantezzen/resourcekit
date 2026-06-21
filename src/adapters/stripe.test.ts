import { describe, expect, test } from "bun:test";
import { testStack } from "../testing/harness";
import { stripeBackbone, type StripeResource } from "./stripe";
import { stripeCustomerResource } from "./stripe/resources";

/** A fake Stripe namespace: an in-memory stand-in for `stripe.customers`. */
function fakeCustomers(): StripeResource {
  const store = new Map<string, Record<string, unknown>>();
  return {
    retrieve: async (id) => {
      const row = store.get(id);
      if (!row) throw new Error(`No such customer: ${id}`);
      return row;
    },
    update: async (id, params) => {
      const next = { ...store.get(id), ...params, id };
      store.set(id, next);
      return next;
    },
  };
}

const customers = stripeCustomerResource();

function stack(seed?: Record<string, unknown>) {
  const api = fakeCustomers();
  if (seed) void api.update(seed.id as string, seed);
  return testStack([customers], {
    ctx: async () => ({}),
    resources: { customers: { backbone: stripeBackbone(api), access: "public" } },
  });
}

describe("stripe customer resource + backbone", () => {
  test("the ready-made resource ships a schema and the right capabilities", () => {
    expect(customers.name).toBe("customers");
    expect(customers.supports).toEqual(["one", "update"]);
    customers.one("cus_1");
    customers.update("cus_1", { name: "Ada" });
    // @ts-expect-error - Stripe has no arbitrary query, so `where` is absent
    customers.where;
    // @ts-expect-error - create goes through Stripe's own flow, not here
    customers.create;
  });

  test("one and update round-trip through the Stripe namespace", async () => {
    const { server } = stack({ id: "cus_1", email: "ada@calc.dev", name: "Ada" });

    expect(
      await server.handlePlan(
        { type: "read", resource: "customers", op: "one", id: "cus_1" },
        {},
      ),
    ).toMatchObject({ name: "Ada" });

    expect(
      await server.handlePlan(
        {
          type: "write",
          resource: "customers",
          op: "patch",
          id: "cus_1",
          patch: { name: "Ada Lovelace" },
        },
        {},
      ),
    ).toMatchObject({ name: "Ada Lovelace" });
  });

  test("an unsupported operation is rejected", async () => {
    const { server } = stack();
    await expect(
      server.handlePlan(
        { type: "read", resource: "customers", op: "where", filter: {} },
        {},
      ),
    ).rejects.toMatchObject({ code: "unsupported" });
  });
});
