// Logged-in sessions. The browser keeps a random id in an HttpOnly cookie;
// the database only stores a hash of it, so a database leak cannot log anyone in.
import { randomToken, sha256Hex } from "../crypto";
import type { Env } from "../env";
import { HttpError } from "../web";

export const SESSION_COOKIE = "mm_session";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  email: string;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const [key, ...rest] = part.split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookie(value: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export async function createSession(env: Env, userId: string): Promise<string> {
  const id = randomToken(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(await sha256Hex(id), userId, now, now + SESSION_DAYS * 86400_000)
    .run();
  return cookie(id, SESSION_DAYS * 86400);
}

export async function getUser(env: Env, request: Request): Promise<User | null> {
  const id = readCookie(request, SESSION_COOKIE);
  if (!id) return null;
  return env.DB.prepare(
    `SELECT users.id AS id, users.email AS email FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id_hash = ?1 AND sessions.expires_at > ?2`,
  )
    .bind(await sha256Hex(id), Date.now())
    .first<User>();
}

export async function requireUser(env: Env, request: Request): Promise<User> {
  const user = await getUser(env, request);
  if (!user) throw new HttpError(401, "Please sign in");
  return user;
}

export async function destroySession(env: Env, request: Request): Promise<string> {
  const id = readCookie(request, SESSION_COOKIE);
  if (id) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?1").bind(await sha256Hex(id)).run();
  return cookie("", 0);
}
