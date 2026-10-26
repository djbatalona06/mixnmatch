// The one Vercel function. Every /api/* request (and the cron) runs through here.
// It turns Vercel's Node request into a standard Request, runs the server code in src/,
// and sends the Response back.
import type { IncomingMessage, ServerResponse } from "node:http";
import { loadEnv } from "../src/env";
import { handle } from "../src/index";

async function readBody(req: IncomingMessage): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const request = new Request(`https://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: await readBody(req),
  });

  const response = await handle(request, loadEnv());

  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}
