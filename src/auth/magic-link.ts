// Email sign-in links ("magic links"). No passwords anywhere.
import { randomToken, sha256Hex } from "../crypto";
import type { Env } from "../env";
import { HttpError } from "../web";

const LINK_MINUTES = 15;
const MAX_LINKS_PER_HOUR = 5;
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function normalizeEmail(raw: unknown): string {
  const email = String(raw ?? "").trim().toLowerCase();
  if (email.length > 320 || !EMAIL_PATTERN.test(email)) throw new HttpError(400, "Please enter a valid email address");
  return email;
}

/** Creates a sign-in link and emails it. In DEV_MODE the link is returned instead. */
export async function requestMagicLink(
  env: Env,
  email: string,
  origin: string,
  ip: string | null,
): Promise<{ devLink?: string }> {
  const hourAgo = Date.now() - 3600_000;
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM magic_links WHERE (email = ?1 OR (ip IS NOT NULL AND ip = ?2)) AND created_at > ?3",
  )
    .bind(email, ip, hourAgo)
    .first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_LINKS_PER_HOUR) throw new HttpError(429, "Too many sign-in emails. Try again in an hour.");

  const token = randomToken(32);
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO magic_links (token_hash, email, ip, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(await sha256Hex(token), email, ip, now, now + LINK_MINUTES * 60_000)
    .run();

  // The link opens a page that asks you to click "Sign in". That stops email
  // scanners (which open links automatically) from using up your link.
  const link = `${origin}/login?token=${token}`;

  if (env.DEV_MODE === "1") {
    console.log(`[dev] sign-in link for ${email}: ${link}`);
    return { devLink: link };
  }
  await sendEmail(env, email, link);
  return {};
}

async function sendEmail(env: Env, to: string, link: string): Promise<void> {
  if (!env.RESEND_API_KEY) throw new HttpError(500, "Email sending is not set up yet");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.EMAIL_FROM ?? "mix n match <onboarding@resend.dev>",
      to: [to],
      subject: "Your mix n match sign-in link",
      text: `Click to sign in to mix n match:\n\n${link}\n\nThis link works once and expires in ${LINK_MINUTES} minutes. If you did not ask for it, ignore this email.`,
      html: `<p>Click to sign in to <strong>mix n match</strong>:</p><p><a href="${link}">Sign in</a></p><p>This link works once and expires in ${LINK_MINUTES} minutes. If you did not ask for it, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    console.error("Resend error", res.status, await res.text().catch(() => ""));
    throw new HttpError(502, "Could not send the email. Please try again.");
  }
}

/** Uses up a sign-in token and returns the (possibly new) user's id. */
export async function consumeMagicLink(env: Env, token: string): Promise<{ userId: string; email: string }> {
  if (!token || token.length > 100) throw new HttpError(400, "Invalid sign-in link");
  const now = Date.now();
  const row = await env.DB.prepare(
    `UPDATE magic_links SET used_at = ?2
     WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2
     RETURNING email`,
  )
    .bind(await sha256Hex(token), now)
    .first<{ email: string }>();
  if (!row) throw new HttpError(400, "This sign-in link has expired or was already used. Please ask for a new one.");

  const user = await env.DB.prepare(
    `INSERT INTO users (id, email, created_at) VALUES (?1, ?2, ?3)
     ON CONFLICT (email) DO UPDATE SET email = excluded.email
     RETURNING id`,
  )
    .bind(crypto.randomUUID(), row.email, now)
    .first<{ id: string }>();
  return { userId: user!.id, email: row.email };
}
