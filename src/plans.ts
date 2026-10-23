// Free vs Premium. One place for every limit, so the numbers never drift apart.
import type { User } from "./auth/session";

export const LIMITS = {
  free: { activeTransfers: 1, syncs: 1, fileTracks: 5_000, bodyBytes: 2 * 1024 * 1024 },
  premium: { activeTransfers: 3, syncs: 20, fileTracks: 20_000, bodyBytes: 8 * 1024 * 1024 },
} as const;

// ponytail: limits are checked when something starts; if Premium lapses without a Stripe "deleted" event,
// extra syncs keep running until the next webhook. Add a daily check in cleanup() if that ever matters.
export function isPremium(user: Pick<User, "plan" | "plan_until">, now = Date.now()): boolean {
  return user.plan === "premium" && (user.plan_until ?? 0) > now;
}

export function limitsFor(user: Pick<User, "plan" | "plan_until">) {
  return isPremium(user) ? LIMITS.premium : LIMITS.free;
}

/** Message for a free user who hits a Premium limit. */
export function upgradeHint(user: Pick<User, "plan" | "plan_until">): string {
  return isPremium(user) ? "" : " Premium raises this limit — see your dashboard.";
}
