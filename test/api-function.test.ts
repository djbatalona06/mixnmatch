// The Vercel function (api/[...path].ts) turns Node's request into a standard Request and back.
// These checks use a fake request and response, so they run without Vercel.
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { testEnv } from "./helpers";

const shared = vi.hoisted(() => ({ env: null as any }));
vi.mock("../src/env", async (original) => ({ ...(await original<object>()), loadEnv: () => shared.env }));

const { default: handler } = await import("../api/[...path]");

class FakeResponse {
  statusCode = 200;
  headers = new Map<string, string | string[]>();
  body = Buffer.alloc(0);
  setHeader(name: string, value: string | string[]) {
    this.headers.set(name.toLowerCase(), value);
  }
  end(chunk: Buffer) {
    this.body = chunk;
  }
  get json() {
    return JSON.parse(this.body.toString("utf8"));
  }
}

function fakeRequest(method: string, url: string, headers: Record<string, string> = {}, body?: string) {
  const stream = Readable.from(body ? [Buffer.from(body)] : []) as any;
  stream.method = method;
  stream.url = url;
  stream.headers = { host: "mixnmatch.test", ...headers };
  return stream;
}

describe("Vercel function", () => {
  it("passes a GET through to the server and returns its JSON", async () => {
    shared.env = (await testEnv()).env;
    const res = new FakeResponse();
    await handler(fakeRequest("GET", "/api/platforms") as any, res as any);
    expect(res.statusCode).toBe(200);
    expect(res.json.platforms).toBeDefined();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("reads the request body for POST requests", async () => {
    shared.env = (await testEnv()).env;
    const res = new FakeResponse();
    const body = JSON.stringify({ email: "x@example.com" });
    // No X-Requested-With header: the server must refuse, which proves the request got through.
    await handler(fakeRequest("POST", "/api/auth/request", { "content-type": "application/json" }, body) as any, res as any);
    expect(res.statusCode).toBe(403);
    expect(res.json.error).toMatch(/X-Requested-With/);
  });

  it("gives the cron its own URL, and refuses callers without the secret", async () => {
    shared.env = (await testEnv()).env;
    const res = new FakeResponse();
    await handler(fakeRequest("GET", "/api/cron/tick") as any, res as any);
    expect(res.statusCode).toBe(401);
  });
});
