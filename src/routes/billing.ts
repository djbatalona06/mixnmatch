// Premium payments with Stripe. Stripe hosts the card pages (Checkout) and the
// "manage / cancel" page (Customer Portal), so card details never touch mix n match.
// We only keep the Stripe customer id and the end date of the paid period.
//
// Stripe is called with plain fetch (form-encoded), like the music adapters: no SDK, no build step.
import type { User } from "../auth/session";
import type { Env } from "../env";
import { LIMITS } from "../plans";
import { audit, HttpError, json } from "../web";
import { pauseExtraSyncs } from "./syncs";

const STRIPE = "https://api.stripe.com/v1";
export const SIGNATURE_TOLERANCE_SEC = 300;

export function billingEnabled(env: Env): boolean {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET && env.STRIPE_PRICE_MONTHLY);
}

async function stripe(env: Env, method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, string>): Promise<any> {
  const res = await fetch(STRIPE + path, {
    method,
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`stripe ${method} ${path} failed`, res.status, data?.error?.message);
    throw new HttpError(502, "The payment service returned an error. Please try again.");
  }
  return data;
}

async function customerId(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT stripe_customer_id FROM users WHERE id = ?1").bind(userId).first<{ stripe_customer_id: string | null }>();
  return row?.stripe_customer_id ?? null;
}

export async function startCheckout(env: Env, user: User, body: { plan?: string }, origin: string): Promise<Response> {
  if (!billingEnabled(env)) throw new HttpError(404, "Premium is not available yet");
  const price = body?.plan === "yearly" ? env.STRIPE_PRICE_YEARLY : env.STRIPE_PRICE_MONTHLY;
  if (!price) throw new HttpError(400, "That plan is not available");
  const customer = await customerId(env, user.id);
  const session = await stripe(env, "POST", "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: user.id,
    "subscription_data[metadata][user_id]": user.id,
    success_url: `${origin}/account?premium=thanks`,
    cancel_url: `${origin}/account`,
    ...(customer ? { customer } : { customer_email: user.email }),
  });
  return json({ url: session.url });
}

export async function openPortal(env: Env, user: User, origin: string): Promise<Response> {
  if (!billingEnabled(env)) throw new HttpError(404, "Premium is not available yet");
  const customer = await customerId(env, user.id);
  if (!customer) throw new HttpError(409, "You don't have a Premium plan yet");
  const session = await stripe(env, "POST", "/billing_portal/sessions", { customer, return_url: `${origin}/account` });
  return json({ url: session.url });
}

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Same length + every byte compared, so timing doesn't leak how much of a guess was right. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks Stripe's `Stripe-Signature: t=…,v1=…` header (HMAC-SHA256 of "t.body"). */
export async function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now()): Promise<boolean> {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || !signatures.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > SIGNATURE_TOLERANCE_SEC) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`)));
  return signatures.some((s) => safeEqual(s, expected));
}

/** End of the paid period, in ms. (Newer Stripe API versions keep it on the subscription item.) */
function periodEnd(sub: any): number | null {
  const sec = sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end;
  return Number.isFinite(sec) ? sec * 1000 : null;
}

async function userForSubscription(env: Env, sub: any): Promise<string | null> {
  const fromMetadata = typeof sub?.metadata?.user_id === "string" ? sub.metadata.user_id : null;
  if (fromMetadata) return fromMetadata;
  const row = await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id = ?1").bind(String(sub?.customer ?? "")).first<{ id: string }>();
  return row?.id ?? null;
}

export async function handleWebhook(env: Env, request: Request): Promise<Response> {
  if (!billingEnabled(env)) throw new HttpError(404, "Not found");
  const payload = await request.text();
  if (payload.length > 512 * 1024) throw new HttpError(413, "Too large");
  if (!(await verifyStripeSignature(payload, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET!))) {
    throw new HttpError(400, "Bad signature");
  }
  const event = JSON.parse(payload);
  const id = String(event.id ?? "");
  const seen = await env.DB.prepare("SELECT 1 FROM billing_events WHERE id = ?1").bind(id).first();
  if (seen) return json({ received: true, duplicate: true });

  const obj = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed": {
      if (obj.client_reference_id && obj.customer) {
        await env.DB.prepare("UPDATE users SET stripe_customer_id = ?2 WHERE id = ?1").bind(obj.client_reference_id, obj.customer).run();
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const userId = await userForSubscription(env, obj);
      if (!userId) break;
      // ponytail: trusts arrival order; compare event.created per user if Stripe's out-of-order delivery ever re-grants a cancelled plan.
      const live = event.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(obj.status);
      if (live) {
        await env.DB.prepare("UPDATE users SET plan = 'premium', plan_until = ?2, stripe_customer_id = COALESCE(stripe_customer_id, ?3) WHERE id = ?1")
          .bind(userId, periodEnd(obj), obj.customer ?? null)
          .run();
      } else {
        await env.DB.prepare("UPDATE users SET plan = 'free', plan_until = ?2 WHERE id = ?1").bind(userId, Date.now()).run();
        await pauseExtraSyncs(env, userId, LIMITS.free.syncs);
      }
      break;
    }
    case "invoice.payment_failed": {
      const row = await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id = ?1").bind(String(obj.customer ?? "")).first<{ id: string }>();
      // Stripe retries the payment and then sends a subscription update; we just keep a note.
      if (row) await audit(env, row.id, "payment_failed", null, null);
      break;
    }
  }
  await env.DB.prepare("INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?1, ?2, ?3)")
    .bind(id, String(event.type ?? ""), Date.now())
    .run();
  return json({ received: true });
}

/** "Delete my account": deleting the Stripe customer cancels their subscription right away. */
export async function deleteStripeCustomer(env: Env, userId: string): Promise<void> {
  if (!env.STRIPE_SECRET_KEY) return;
  const customer = await customerId(env, userId);
  if (customer) await stripe(env, "DELETE", `/customers/${encodeURIComponent(customer)}`);
}
