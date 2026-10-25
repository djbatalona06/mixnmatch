// mix n match: the server code. Vercel serves the files in /public itself; this handles /api/*.
import { timingSafeEqual } from "node:crypto";
import { getAdapter, isPlatform, platformList } from "./adapters/registry";
import type { Page, Platform, Playlist, Track } from "./adapters/types";
import { consumeMagicLink, normalizeEmail, requestMagicLink } from "./auth/magic-link";
import { createSession, destroySession, requireUser, type User } from "./auth/session";
import { deleteConnection, listConnections, saveConnection, withToken } from "./connections";
import { codeChallengeS256, createCodeVerifier, randomToken } from "./crypto";
import type { Env } from "./env";
import { ApiError, AuthError, QuotaError, RateLimitError } from "./http";
import { isPremium, limitsFor } from "./plans";
import { billingEnabled, deleteStripeCustomer, handleWebhook, openPortal, startCheckout } from "./routes/billing";
import { fixItem, searchForItem, skipItem } from "./routes/fix";
import { cancelJob, createJob, getJob, listJobItems, listJobs, retryJob } from "./routes/jobs";
import { runDueJobs } from "./jobs/runner";
import { createSync, deleteSync, listSyncs, reactivateSyncs, runDueSyncs, updateSync } from "./routes/syncs";
import { audit, clientIp, HttpError, json, readJson, redirect, requireSameOrigin } from "./web";

const OAUTH_STATE_MINUTES = 10;
// Vercel calls the cron every minute. Each call may run transfer steps for this long
// (the function may run for up to 300 seconds, see vercel.json).
const CRON_BUDGET_MS = 150_000;

function platformParam(value: string): Platform {
  if (!isPlatform(value)) throw new HttpError(404, "Unknown music service");
  return value;
}

const JOB = "([0-9a-f-]{36})";

async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method;
  // Stripe calls this itself (no cookie, no X-Requested-With); it is checked by signature instead.
  if (path === "/api/billing/webhook" && method === "POST") return handleWebhook(env, request);
  if (path === "/api/cron/tick" && method === "GET") return runCron(env, request);
  requireSameOrigin(request);
  const ip = clientIp(request);
  let m: RegExpMatchArray | null;

  // ---------- Sign in / out ----------
  if (path === "/api/auth/request" && method === "POST") {
    const body = await readJson<{ email?: string }>(request);
    const email = normalizeEmail(body.email);
    const result = await requestMagicLink(env, email, url.origin, ip);
    return json({ ok: true, ...result });
  }
  if (path === "/api/auth/verify" && method === "POST") {
    const body = await readJson<{ token?: string }>(request);
    const { userId } = await consumeMagicLink(env, String(body.token ?? ""));
    const cookie = await createSession(env, userId);
    await audit(env, userId, "sign_in", null, ip);
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  }
  if (path === "/api/auth/logout" && method === "POST") {
    return json({ ok: true }, 200, { "Set-Cookie": await destroySession(env, request) });
  }
  if (path === "/api/platforms" && method === "GET") {
    return json({ platforms: platformList(env) });
  }

  // Everything below needs a signed-in user.
  const user = await requireUser(env, request);

  if (path === "/api/me" && method === "GET") {
    return json({
      email: user.email,
      connections: await listConnections(env, user.id),
      platforms: platformList(env),
      plan: isPremium(user) ? "premium" : "free",
      planUntil: isPremium(user) ? user.plan_until : null,
      limits: limitsFor(user),
      billing: billingEnabled(env) ? { yearly: !!env.STRIPE_PRICE_YEARLY } : null,
    });
  }
  if (path === "/api/me" && method === "DELETE") {
    await deleteAccount(env, user, ip);
    return json({ ok: true }, 200, { "Set-Cookie": await destroySession(env, request) });
  }

  // ---------- Connecting music services (OAuth) ----------
  if ((m = path.match(/^\/api\/connect\/([a-z]+)$/)) && method === "GET") {
    const platform = platformParam(m[1]);
    const adapter = getAdapter(env, platform);
    const state = randomToken(24);
    const verifier = createCodeVerifier();
    await env.DB.prepare(
      "INSERT INTO oauth_states (state, user_id, platform, code_verifier, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
      .bind(state, user.id, platform, verifier, Date.now() + OAUTH_STATE_MINUTES * 60_000)
      .run();
    return redirect(
      adapter.getAuthUrl({
        state,
        codeChallenge: await codeChallengeS256(verifier),
        redirectUri: `${url.origin}/api/callback/${platform}`,
      }),
    );
  }
  if ((m = path.match(/^\/api\/callback\/([a-z]+)$/)) && method === "GET") {
    const platform = platformParam(m[1]);
    return finishConnect(env, user, platform, url, ip);
  }
  if ((m = path.match(/^\/api\/connections\/([a-z]+)$/)) && method === "DELETE") {
    const platform = platformParam(m[1]);
    await deleteConnection(env, user.id, platform);
    await audit(env, user.id, "disconnect", platform, ip);
    return json({ ok: true });
  }

  // ---------- Browsing a library ----------
  if ((m = path.match(/^\/api\/library\/([a-z]+)\/(playlists|liked)(?:\/([^/]+)\/tracks)?$/)) && method === "GET") {
    const platform = platformParam(m[1]);
    const adapter = getAdapter(env, platform);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const playlistId = m[3] ? decodeURIComponent(m[3]) : undefined;
    const page = await withToken<Page<Playlist | Track>>(env, user.id, adapter, (token) => {
      if (m![2] === "liked") return adapter.getSavedTracks(token, cursor);
      if (playlistId) return adapter.getPlaylistTracks(token, playlistId, cursor);
      return adapter.getPlaylists(token, cursor);
    });
    return json(page);
  }

  // ---------- Transfers ----------
  if (path === "/api/jobs" && method === "POST") {
    const response = await createJob(env, user, await readJson(request, limitsFor(user).bodyBytes));
    await audit(env, user.id, "transfer_start", null, ip);
    return response;
  }
  if (path === "/api/jobs" && method === "GET") return listJobs(env, user);
  if ((m = path.match(new RegExp(`^/api/jobs/${JOB}$`))) && method === "GET") return getJob(env, user, m[1]);
  if ((m = path.match(new RegExp(`^/api/jobs/${JOB}/items$`))) && method === "GET") return listJobItems(env, user, m[1], url);
  if ((m = path.match(new RegExp(`^/api/jobs/${JOB}/cancel$`))) && method === "POST") {
    await audit(env, user.id, "transfer_cancel", m[1], ip);
    return cancelJob(env, user, m[1]);
  }
  if ((m = path.match(new RegExp(`^/api/jobs/${JOB}/retry$`))) && method === "POST") {
    await audit(env, user.id, "transfer_retry", m[1], ip);
    return retryJob(env, user, m[1], await readJson(request));
  }

  // ---------- Fix-it screen ----------
  if ((m = path.match(new RegExp(`^/api/jobs/${JOB}/items/(\\d{1,12})/(search|fix|skip)$`)))) {
    const [, jobId, itemId, action] = m;
    if (action === "search" && method === "GET") return searchForItem(env, user, jobId, Number(itemId), url);
    if (action === "fix" && method === "POST") return fixItem(env, user, jobId, Number(itemId), await readJson(request));
    if (action === "skip" && method === "POST") return skipItem(env, user, jobId, Number(itemId));
  }

  // ---------- Auto-Sync ----------
  if (path === "/api/syncs" && method === "GET") return listSyncs(env, user);
  if (path === "/api/syncs" && method === "POST") {
    const response = await createSync(env, user, await readJson(request));
    await audit(env, user.id, "sync_create", null, ip);
    return response;
  }
  if ((m = path.match(new RegExp(`^/api/syncs/${JOB}$`)))) {
    if (method === "PATCH") return updateSync(env, user, m[1], await readJson(request));
    if (method === "DELETE") {
      await audit(env, user.id, "sync_delete", m[1], ip);
      return deleteSync(env, user, m[1]);
    }
  }

  // ---------- Premium ----------
  if (path === "/api/billing/checkout" && method === "POST") return startCheckout(env, user, await readJson(request), url.origin);
  if (path === "/api/billing/portal" && method === "POST") return openPortal(env, user, url.origin);

  throw new HttpError(404, "Not found");
}

async function finishConnect(env: Env, user: User, platform: Platform, url: URL, ip: string | null): Promise<Response> {
  const back = (query: string) => redirect(`/dashboard?${query}`);
  if (url.searchParams.get("error") || url.searchParams.get("error_reason")) return back(`error=denied&platform=${platform}`);

  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const saved = await env.DB.prepare(
    "DELETE FROM oauth_states WHERE state = ?1 AND user_id = ?2 AND platform = ?3 AND expires_at > ?4 RETURNING code_verifier",
  )
    .bind(state, user.id, platform, Date.now())
    .first<{ code_verifier: string }>();
  if (!saved || !code) return back(`error=expired&platform=${platform}`);

  const adapter = getAdapter(env, platform);
  try {
    const tokens = await adapter.exchangeCode(code, saved.code_verifier, `${url.origin}/api/callback/${platform}`);
    const profile = await adapter.getProfile(tokens.accessToken).catch(() => undefined);
    await saveConnection(env, user.id, platform, tokens, profile);
    await reactivateSyncs(env, user.id, platform);
    await audit(env, user.id, "connect", platform, ip);
    return back(`connected=${platform}`);
  } catch (err) {
    console.error(`connect ${platform} failed`, err);
    return back(`error=failed&platform=${platform}`);
  }
}

async function deleteAccount(env: Env, user: User, ip: string | null): Promise<void> {
  // Cancel Premium first, so nobody keeps paying for a deleted account.
  await deleteStripeCustomer(env, user.id);
  // Child rows are removed by ON DELETE CASCADE; we delete them explicitly too, to be safe.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sync_seen WHERE sync_id IN (SELECT id FROM syncs WHERE user_id = ?1)").bind(user.id),
    env.DB.prepare("DELETE FROM syncs WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM transfer_items WHERE job_id IN (SELECT id FROM transfer_jobs WHERE user_id = ?1)").bind(user.id),
    env.DB.prepare("DELETE FROM transfer_selections WHERE job_id IN (SELECT id FROM transfer_jobs WHERE user_id = ?1)").bind(user.id),
    env.DB.prepare("DELETE FROM transfer_jobs WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM connections WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM oauth_states WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM magic_links WHERE email = ?1").bind(user.email),
    env.DB.prepare("UPDATE audit_log SET user_id = NULL, ip = NULL WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
  ]);
  await audit(env, null, "account_deleted", null, ip);
}

function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status);
  if (err instanceof AuthError) return json({ error: `${err.message}. Try reconnecting the service.` }, 401);
  if (err instanceof RateLimitError) return json({ error: "The music service is busy. Try again in a moment." }, 503);
  if (err instanceof QuotaError) return json({ error: "Today's YouTube allowance is used up. Try again tomorrow." }, 503);
  if (err instanceof ApiError) return json({ error: "The music service returned an error. Please try again." }, 502);
  console.error(err);
  return json({ error: "Something went wrong on our side." }, 500);
}

/** Daily clean-up: expired logins, and old transfer details (privacy: 30 days). */
export async function cleanup(env: Env, now = Date.now()): Promise<void> {
  const day = 86400_000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM magic_links WHERE expires_at < ?1").bind(now - day),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?1").bind(now),
    env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?1").bind(now),
    env.DB.prepare(
      "DELETE FROM transfer_items WHERE job_id IN (SELECT id FROM transfer_jobs WHERE created_at < ?1 AND status IN ('DONE','FAILED','CANCELLED'))",
    ).bind(now - 30 * day),
    env.DB.prepare("UPDATE audit_log SET ip = NULL WHERE at < ?1").bind(now - 30 * day),
    env.DB.prepare("DELETE FROM audit_log WHERE at < ?1").bind(now - 365 * day),
    env.DB.prepare("DELETE FROM match_cache WHERE updated_at < ?1").bind(now - 90 * day),
    env.DB.prepare("DELETE FROM api_quota WHERE day < ?1").bind(new Date(now - 7 * day).toISOString().slice(0, 10)),
  ]);
}

/** Every /api/* request comes in here (through api/[...path].ts). */
export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
  try {
    return await handleApi(request, env, url);
  } catch (err) {
    // Browser navigations (connect/callback) should land on a page, not raw JSON.
    if (err instanceof HttpError && err.status === 401 && request.method === "GET" && /^\/api\/(connect|callback)\//.test(url.pathname)) {
      return redirect("/login");
    }
    return errorResponse(err);
  }
}

/** Only Vercel knows this secret. Vercel sends it with every cron call; nobody else gets in. */
function isFromVercelCron(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("Authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Runs once a minute (vercel.json). Clean-up at 03:17 UTC, then due Auto-Syncs,
 * then as many transfer steps as fit in the time budget.
 */
async function runCron(env: Env, request: Request): Promise<Response> {
  if (!isFromVercelCron(request, env.CRON_SECRET)) throw new HttpError(401, "Not allowed");
  const now = new Date();
  if (now.getUTCHours() === 3 && now.getUTCMinutes() === 17) await cleanup(env);
  const syncs = await runDueSyncs(env);
  const steps = await runDueJobs(env, CRON_BUDGET_MS);
  return json({ ok: true, syncs, steps });
}
