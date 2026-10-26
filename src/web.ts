// Small helpers for building API responses.
import type { Env } from "./env";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

export function redirect(location: string, headers: HeadersInit = {}): Response {
  return new Response(null, { status: 302, headers: { Location: location, ...SECURITY_HEADERS, ...headers } });
}

/** Reads a JSON body, refusing anything too large. */
export async function readJson<T>(request: Request, maxBytes = 64 * 1024): Promise<T> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request is too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

export function clientIp(request: Request): string | null {
  // Vercel sets these headers itself. Unlike x-forwarded-for, a visitor cannot fake them.
  return request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-real-ip");
}

export async function audit(env: Env, userId: string | null, action: string, detail: string | null, ip: string | null) {
  await env.DB.prepare("INSERT INTO audit_log (user_id, action, detail, ip, at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(userId, action, detail, ip, Date.now())
    .run();
}

/** Mutating API calls must come from our own pages (blocks cross-site form posts). */
export function requireSameOrigin(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (request.headers.get("X-Requested-With") !== "mixnmatch") {
    throw new HttpError(403, "Missing X-Requested-With header");
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, "Cross-origin request blocked");
}
