import { describe, expect, it, vi } from "vitest";
import { codeChallengeS256, decrypt, encrypt, randomToken, toBase64 } from "../src/crypto";
import { AuthError, RateLimitError, parseRetryAfter, requestJson } from "../src/http";
import { consumeMagicLink, normalizeEmail, requestMagicLink } from "../src/auth/magic-link";
import { createSession, getUser, readCookie } from "../src/auth/session";
import { getAccessToken, saveConnection } from "../src/connections";
import { requireSameOrigin } from "../src/web";
import { createMockAdapter } from "../src/adapters/mock";
import { createTestDb } from "./d1-shim";

const KEY = toBase64(new Uint8Array(32).fill(7));

function testEnv() {
  return { DB: createTestDb(), TOKEN_KEY: KEY, DEV_MODE: "1", ENABLE_MOCK: "1" } as any;
}

describe("token encryption", () => {
  it("round-trips and is bound to its context", async () => {
    const { ciphertext, iv } = await encrypt(KEY, "secret-token", "user1:spotify");
    expect(ciphertext).not.toContain("secret");
    expect(await decrypt(KEY, ciphertext, iv, "user1:spotify")).toBe("secret-token");
    await expect(decrypt(KEY, ciphertext, iv, "user2:spotify")).rejects.toThrow();
  });

  it("uses a fresh IV each time", async () => {
    const a = await encrypt(KEY, "x", "c");
    const b = await encrypt(KEY, "x", "c");
    expect(a.iv).not.toBe(b.iv);
  });

  it("rejects keys of the wrong size", async () => {
    await expect(encrypt(toBase64(new Uint8Array(16)), "x", "c")).rejects.toThrow(/32 bytes/);
  });
});

describe("PKCE", () => {
  it("matches the RFC 7636 example", async () => {
    expect(await codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe("requestJson", () => {
  it("retries a short 429 then succeeds", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(Response.json({ ok: 1 }));
    expect(await requestJson(fetchFn, "https://x.test")).toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws RateLimitError for long Retry-After so the job can pause", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "Retry-After": "120" } }));
    const err = await requestJson(fetchFn, "https://x.test").catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfterSec).toBe(120);
  });

  it("throws AuthError on 401", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("", { status: 401 }));
    await expect(requestJson(fetchFn, "https://x.test")).rejects.toBeInstanceOf(AuthError);
  });

  it("parses Retry-After dates", () => {
    expect(parseRetryAfter(new Date(Date.now() + 10_000).toUTCString())).toBeGreaterThanOrEqual(9);
    expect(parseRetryAfter(null, 3)).toBe(3);
  });
});

describe("magic links", () => {
  it("creates a one-time link that signs the user in", async () => {
    const env = testEnv();
    const { devLink } = await requestMagicLink(env, "a@example.com", "https://mm.test", "1.2.3.4");
    const token = new URL(devLink!).searchParams.get("token")!;
    const { userId, email } = await consumeMagicLink(env, token);
    expect(email).toBe("a@example.com");
    await expect(consumeMagicLink(env, token)).rejects.toThrow(/expired or was already used/);

    // Same email later -> same user.
    const second = await requestMagicLink(env, "a@example.com", "https://mm.test", "1.2.3.4");
    const again = await consumeMagicLink(env, new URL(second.devLink!).searchParams.get("token")!);
    expect(again.userId).toBe(userId);
  });

  it("stores only a hash of the token", async () => {
    const env = testEnv();
    const { devLink } = await requestMagicLink(env, "b@example.com", "https://mm.test", null);
    const token = new URL(devLink!).searchParams.get("token")!;
    const rows = env.DB.raw.prepare("SELECT token_hash FROM magic_links").all() as any[];
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toHaveLength(64);
  });

  it("rate limits repeated requests", async () => {
    const env = testEnv();
    for (let i = 0; i < 5; i++) await requestMagicLink(env, "c@example.com", "https://mm.test", null);
    await expect(requestMagicLink(env, "c@example.com", "https://mm.test", null)).rejects.toThrow(/Too many/);
  });

  it("validates emails", () => {
    expect(normalizeEmail(" Me@Example.COM ")).toBe("me@example.com");
    expect(() => normalizeEmail("not-an-email")).toThrow();
  });
});

describe("sessions", () => {
  it("cookie is HttpOnly + Secure and resolves to the user", async () => {
    const env = testEnv();
    const { devLink } = await requestMagicLink(env, "d@example.com", "https://mm.test", null);
    const { userId } = await consumeMagicLink(env, new URL(devLink!).searchParams.get("token")!);
    const setCookie = await createSession(env, userId);
    expect(setCookie).toMatch(/HttpOnly; Secure; SameSite=Lax/);
    const value = setCookie.split(";")[0];
    const request = new Request("https://mm.test/api/me", { headers: { Cookie: value } });
    expect(readCookie(request, "mm_session")).toBe(value.split("=")[1]);
    expect((await getUser(env, request))?.email).toBe("d@example.com");
    expect(await getUser(env, new Request("https://mm.test", { headers: { Cookie: "mm_session=nope" } }))).toBeNull();
  });
});

describe("CSRF guard", () => {
  it("blocks POSTs without our header or from other sites", () => {
    expect(() => requireSameOrigin(new Request("https://mm.test/api/x", { method: "POST" }))).toThrow();
    expect(() =>
      requireSameOrigin(
        new Request("https://mm.test/api/x", {
          method: "POST",
          headers: { "X-Requested-With": "mixnmatch", Origin: "https://evil.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      requireSameOrigin(
        new Request("https://mm.test/api/x", {
          method: "POST",
          headers: { "X-Requested-With": "mixnmatch", Origin: "https://mm.test" },
        }),
      ),
    ).not.toThrow();
  });
});

describe("stored connections", () => {
  it("encrypts tokens at rest and refreshes expiring ones", async () => {
    const env = testEnv();
    env.DB.raw.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'e@example.com', 0)").run();
    const adapter = createMockAdapter();
    const refresh = vi.spyOn(adapter, "refresh");
    await saveConnection(env, "u1", "mock", { accessToken: "plain-access", refreshToken: "r", expiresAt: Date.now() - 1 });
    const row = env.DB.raw.prepare("SELECT enc_tokens FROM connections").get() as any;
    expect(row.enc_tokens).not.toContain("plain-access");
    expect(await getAccessToken(env, "u1", adapter)).toBe("mock-access");
    expect(refresh).toHaveBeenCalledOnce();
  });
});
