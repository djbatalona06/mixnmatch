// Stand-in for the "cloudflare:workers" module so Durable Object classes can be unit-tested in Node.
export class DurableObject<E = unknown> {
  constructor(
    public ctx: any,
    public env: E,
  ) {}
}
