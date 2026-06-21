import { z } from "zod";
import { resource } from "../../core/resource";

/**
 * Ready-made resources for common Stripe objects - schema, mode, and
 * supported operations already wired, so integrating Stripe is one line:
 *
 * ```ts
 * import { stripeCustomerResource } from "resourcekit/stripe/resources";
 * export const customers = stripeCustomerResource();
 * ```
 *
 * This module is pure data (Zod + `resource`) - it imports no Stripe SDK,
 * so it's safe in shared/client code. The matching backbones live in
 * `resourcekit/stripe`.
 *
 * The schemas cover the fields apps commonly sync. Reads pass Stripe's
 * full object through untouched; the schema just types what you work with
 * locally and validates writes. Need more fields? Spread one of these
 * schemas into your own and build the resource by hand.
 */

const metadata = z.record(z.string(), z.string());

export const StripeCustomerSchema = z.object({
  id: z.string(),
  email: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  metadata: metadata.optional(),
  created: z.number().optional(),
});
export type StripeCustomer = z.infer<typeof StripeCustomerSchema>;

export const StripeSubscriptionSchema = z.object({
  id: z.string(),
  customer: z.string(),
  status: z.string(),
  cancel_at_period_end: z.boolean().optional(),
  current_period_start: z.number().optional(),
  current_period_end: z.number().optional(),
  metadata: metadata.optional(),
  created: z.number().optional(),
});
export type StripeSubscription = z.infer<typeof StripeSubscriptionSchema>;

export const StripeProductSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  active: z.boolean().optional(),
  default_price: z.string().nullable().optional(),
  metadata: metadata.optional(),
  created: z.number().optional(),
});
export type StripeProduct = z.infer<typeof StripeProductSchema>;

export const StripePriceSchema = z.object({
  id: z.string(),
  product: z.string(),
  currency: z.string(),
  unit_amount: z.number().nullable().optional(),
  active: z.boolean().optional(),
  type: z.string().optional(),
  metadata: metadata.optional(),
  created: z.number().optional(),
});
export type StripePrice = z.infer<typeof StripePriceSchema>;

// Stripe objects are addressed by id, can't be queried with an arbitrary
// filter, and are created/deleted through their own flows - so these
// resources expose lookup + update. Widen with your own resource if you
// need more.
const STRIPE_SUPPORTS = ["one", "update"] as const;

export function stripeCustomerResource() {
  return resource("customers", {
    schema: StripeCustomerSchema,
    mode: "document",
    supports: STRIPE_SUPPORTS,
  });
}

export function stripeSubscriptionResource() {
  return resource("subscriptions", {
    schema: StripeSubscriptionSchema,
    mode: "document",
    supports: STRIPE_SUPPORTS,
  });
}

export function stripeProductResource() {
  return resource("products", {
    schema: StripeProductSchema,
    mode: "document",
    supports: STRIPE_SUPPORTS,
  });
}

export function stripePriceResource() {
  return resource("prices", {
    schema: StripePriceSchema,
    mode: "document",
    supports: STRIPE_SUPPORTS,
  });
}
