import type Stripe from "stripe";
import { SourceBackbone, type ExecutionContext } from "../../core/backbone";
import { ResourceKitError, UnsupportedOperationError } from "../../errors";
import type { QueryPlan } from "../../plan/plan";

type Row = Record<string, unknown>;

/**
 * Minimal structural view of one Stripe resource namespace (e.g.
 * `stripe.customers`). `retrieve` and `update` are universal; `create`
 * and `del` vary by object, so they're optional and the backbone reports
 * `unsupported` if one is missing.
 */
export type StripeResource = {
  retrieve(id: string): Promise<Row>;
  update(id: string, params: Row): Promise<Row>;
  create?(params: Row): Promise<Row>;
  del?(id: string): Promise<unknown>;
};

/**
 * Source backbone over a Stripe resource namespace - the canonical
 * *partial* backbone. Stripe addresses objects by id and has no general
 * filter language, so it serves `one` and `update` (plus `create` /
 * `delete` where the object supports them) but never `where`. Pair it
 * with a [ready-made resource](/docs/reference/adapters) from
 * `resourcekit/stripe/resources` so the typed surface matches.
 */
class StripeSourceBackbone extends SourceBackbone {
  constructor(private readonly api: StripeResource) {
    super();
  }

  canFulfill(plan: QueryPlan, _exec: ExecutionContext): boolean {
    if (plan.type === "read") return plan.op === "one";
    if (plan.op === "create") return typeof this.api.create === "function";
    if (plan.op === "delete") return typeof this.api.del === "function";
    return plan.op === "patch";
  }

  async execute(plan: QueryPlan, _exec: ExecutionContext): Promise<unknown> {
    switch (plan.op) {
      case "one":
        return this.api.retrieve(String(plan.id));
      case "patch":
        return this.api.update(String(plan.id), plan.patch);
      case "create":
        if (!this.api.create) throw this.unsupported("create", plan.resource);
        return this.api.create(plan.record);
      case "delete":
        if (!this.api.del) throw this.unsupported("delete", plan.resource);
        await this.api.del(String(plan.id));
        return null;
      case "where":
        throw this.unsupported(
          "where",
          plan.resource,
          " - Stripe has no general query language; use a named query",
        );
      case "named":
      case "action":
        throw new ResourceKitError(
          "internal",
          "Action and named-query plans must be resolved before reaching a source backbone.",
        );
    }
  }

  private unsupported(op: string, resource: string, hint = ""): Error {
    return new UnsupportedOperationError(
      `The Stripe backbone for "${resource}" can't ${op}${hint}.`,
    );
  }
}

/**
 * A Stripe-backed source backbone for one resource namespace. Most apps
 * use the typed per-object factories below instead.
 *
 * @example
 * ```ts
 * stripeBackbone(stripe.customers);
 * ```
 */
export function stripeBackbone(api: StripeResource): SourceBackbone {
  return new StripeSourceBackbone(api);
}

/**
 * Typed backbones bound to a real `Stripe` client's namespaces - pair
 * each with the matching resource from `resourcekit/stripe/resources`.
 *
 * @example
 * ```ts
 * import Stripe from "stripe";
 * const stripe = new Stripe(process.env.STRIPE_KEY!);
 *
 * // server config:
 * customers: { backbone: stripeCustomerBackbone(stripe), access: "public" },
 * ```
 */
export function stripeCustomerBackbone(stripe: Stripe): SourceBackbone {
  return stripeBackbone(stripe.customers as unknown as StripeResource);
}

export function stripeSubscriptionBackbone(stripe: Stripe): SourceBackbone {
  return stripeBackbone(stripe.subscriptions as unknown as StripeResource);
}

export function stripeProductBackbone(stripe: Stripe): SourceBackbone {
  return stripeBackbone(stripe.products as unknown as StripeResource);
}

export function stripePriceBackbone(stripe: Stripe): SourceBackbone {
  return stripeBackbone(stripe.prices as unknown as StripeResource);
}
