// v1.2 Feature 6: Premium payments (Stripe webhook) and the plan limits.
import { describe, expect, it } from "vitest";
import { handleWebhook, verifyStripeSignature } from "../src/routes/billing";
import { isPremium, limitsFor } from "../src/plans";
import { requireFreeSlot } from "../src/routes/jobs";
import { addJob, all, one, testEnv, USER } from "./helpers";

const SECRET = "whsec_test";

async function sign(payload: string, t = Math.floor(Date.now() / 1000), secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${payload}`));
  return `t=${t},v1=${[...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function billingEnv() {
  const t = await testEnv();
  Object.assign(t.env, { STRIPE_SECRET_KEY: "sk_test", STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_MONTHLY: "price_m" });
  return t;
}

async function post(env: any, event: object, signature?: string) {
  const body = JSON.stringify(event);
  const request = new Request("https://mm.test/api/billing/webhook", {
    method: "POST",
    body,
    headers: { "Stripe-Signature": signature ?? (await sign(body)) },
  });
  return handleWebhook(env, request);
}

const subscription = (type: string, status: string, end = Math.floor(Date.now() / 1000) + 30 * 86400) => ({
  id: `evt_${crypto.randomUUID()}`,
  type,
  data: { object: { id: "sub_1", customer: "cus_1", status, metadata: { user_id: "u1" }, items: { data: [{ current_period_end: end }] } } },
});

describe("Stripe signature", () => {
  it("accepts a correct signature and refuses wrong, old or missing ones", async () => {
    const body = '{"id":"evt_1"}';
    expect(await verifyStripeSignature(body, await sign(body), SECRET)).toBe(true);
    expect(await verifyStripeSignature(body, await sign(body, undefined, "whsec_other"), SECRET)).toBe(false);
    expect(await verifyStripeSignature(`${body} `, await sign(body), SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, await sign(body, Math.floor(Date.now() / 1000) - 3600), SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, null, SECRET)).toBe(false);
    expect(await verifyStripeSignature(body, "t=abc,v1=00", SECRET)).toBe(false);
  });
});

describe("Stripe webhook", () => {
  it("a bad signature changes nothing", async () => {
    const { env, db } = await billingEnv();
    await expect(post(env, subscription("customer.subscription.created", "active"), "t=1,v1=bad")).rejects.toMatchObject({ status: 400 });
    expect(one(db, "SELECT plan FROM users").plan).toBe("free");
  });

  it("turns Premium on, and handles the same event only once", async () => {
    const { env, db } = await billingEnv();
    const event = subscription("customer.subscription.created", "active");
    await post(env, event);
    const user = one(db, "SELECT plan, plan_until, stripe_customer_id FROM users");
    expect(user.plan).toBe("premium");
    expect(user.stripe_customer_id).toBe("cus_1");
    expect(isPremium(user)).toBe(true);
    const again = await (await post(env, event)).json();
    expect(again).toMatchObject({ duplicate: true });
    expect(one(db, "SELECT COUNT(*) AS n FROM billing_events").n).toBe(1);
  });

  it("when Premium ends, extra syncs are paused, never deleted", async () => {
    const { env, db } = await billingEnv();
    await post(env, subscription("customer.subscription.created", "active"));
    for (let i = 0; i < 3; i++) {
      db.raw
        .prepare("INSERT INTO syncs (id, user_id, source, dest, source_id, dest_playlist_id, name, status, next_run_at, created_at) VALUES (?, 'u1', 'mock', 'mock', ?, 'p', 'n', 'ACTIVE', 0, ?)")
        .run(`s${i}`, `src${i}`, i);
    }
    await post(env, subscription("customer.subscription.deleted", "canceled"));
    expect(one(db, "SELECT plan FROM users").plan).toBe("free");
    expect(all(db, "SELECT id, status FROM syncs ORDER BY id")).toEqual([
      { id: "s0", status: "ACTIVE" },
      { id: "s1", status: "PAUSED" },
      { id: "s2", status: "PAUSED" },
    ]);
  });

  it("checkout links the Stripe customer to the user", async () => {
    const { env, db } = await billingEnv();
    await post(env, { id: "evt_c", type: "checkout.session.completed", data: { object: { client_reference_id: "u1", customer: "cus_9" } } });
    expect(one(db, "SELECT stripe_customer_id FROM users").stripe_customer_id).toBe("cus_9");
  });
});

describe("plan limits", () => {
  it("free: 1 transfer at a time; Premium: 3", async () => {
    const { env, db } = await testEnv();
    await addJob(db, { selections: [{ kind: "liked", name: "Liked Songs" }] }, "RUNNING");
    await expect(requireFreeSlot(env, USER)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Premium/) });
    const premium = { ...USER, plan: "premium", plan_until: Date.now() + 86400_000 };
    await expect(requireFreeSlot(env, premium)).resolves.toBeUndefined();
    expect(limitsFor(premium).syncs).toBe(20);
    // An expired Premium counts as free.
    expect(isPremium({ plan: "premium", plan_until: Date.now() - 1 })).toBe(false);
  });
});
