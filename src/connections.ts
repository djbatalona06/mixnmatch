// Saving and loading a user's connected music accounts (tokens are always encrypted).
import type { Platform, PlatformAdapter, Profile, Tokens } from "./adapters/types";
import { decrypt, encrypt } from "./crypto";
import type { Env } from "./env";
import { AuthError } from "./http";

// Refresh a little before the token actually expires.
const REFRESH_MARGIN_MS = 2 * 60 * 1000;

const context = (userId: string, platform: string) => `${userId}:${platform}`;

export async function saveConnection(
  env: Env,
  userId: string,
  platform: Platform,
  tokens: Tokens,
  profile?: Profile,
): Promise<void> {
  const { ciphertext, iv } = await encrypt(env.TOKEN_KEY, JSON.stringify(tokens), context(userId, platform));
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO connections (user_id, platform, account_id, account_name, image_url, enc_tokens, iv, expires_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
     ON CONFLICT (user_id, platform) DO UPDATE SET
       account_id = COALESCE(excluded.account_id, connections.account_id),
       account_name = COALESCE(excluded.account_name, connections.account_name),
       image_url = COALESCE(excluded.image_url, connections.image_url),
       enc_tokens = excluded.enc_tokens, iv = excluded.iv,
       expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
  )
    .bind(
      userId,
      platform,
      profile?.id ?? null,
      profile?.displayName ?? null,
      profile?.imageUrl ?? null,
      ciphertext,
      iv,
      tokens.expiresAt ?? null,
      now,
    )
    .run();
}

/** Returns a working access token, refreshing it first if it is about to expire. */
export async function getAccessToken(
  env: Env,
  userId: string,
  adapter: PlatformAdapter,
  forceRefresh = false,
): Promise<string> {
  const row = await env.DB.prepare("SELECT enc_tokens, iv FROM connections WHERE user_id = ?1 AND platform = ?2")
    .bind(userId, adapter.id)
    .first<{ enc_tokens: string; iv: string }>();
  if (!row) throw new AuthError(`${adapter.name} is not connected`);

  const tokens: Tokens = JSON.parse(await decrypt(env.TOKEN_KEY, row.enc_tokens, row.iv, context(userId, adapter.id)));
  const expiring = tokens.expiresAt !== undefined && tokens.expiresAt - REFRESH_MARGIN_MS < Date.now();
  if (!forceRefresh && !expiring) return tokens.accessToken;

  if (!tokens.refreshToken) throw new AuthError(`${adapter.name} needs to be reconnected`);
  const fresh = await adapter.refresh(tokens.refreshToken);
  await saveConnection(env, userId, adapter.id, fresh);
  return fresh.accessToken;
}

/** Runs `fn` with a token; if the service says the token is bad, refreshes once and retries. */
export async function withToken<T>(
  env: Env,
  userId: string,
  adapter: PlatformAdapter,
  fn: (token: string) => Promise<T>,
): Promise<T> {
  const token = await getAccessToken(env, userId, adapter);
  try {
    return await fn(token);
  } catch (err) {
    if (!(err instanceof AuthError)) throw err;
    return fn(await getAccessToken(env, userId, adapter, true));
  }
}

export async function listConnections(env: Env, userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT platform, account_name, image_url, created_at FROM connections WHERE user_id = ?1 ORDER BY created_at",
  )
    .bind(userId)
    .all<{ platform: string; account_name: string | null; image_url: string | null; created_at: number }>();
  return results.map((r) => ({
    platform: r.platform,
    accountName: r.account_name,
    imageUrl: r.image_url,
    connectedAt: r.created_at,
  }));
}

export async function deleteConnection(env: Env, userId: string, platform: string): Promise<void> {
  await env.DB.prepare("DELETE FROM connections WHERE user_id = ?1 AND platform = ?2").bind(userId, platform).run();
}
