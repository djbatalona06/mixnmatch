// A tiny stand-in for Cloudflare D1 built on Node's built-in SQLite,
// so the real SQL in our code can be tested without Cloudflare.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

class Statement {
  private params: unknown[] = [];
  constructor(
    private db: DatabaseSync,
    private sql: string,
    public counter: { queries: number },
  ) {}
  bind(...params: unknown[]) {
    const s = new Statement(this.db, this.sql, this.counter);
    s.params = params.map((p) => (p === undefined ? null : p));
    return s;
  }
  private stmt() {
    this.counter.queries++;
    // D1 numbers params as ?1, ?2...; node:sqlite accepts the same syntax via an object or array.
    return this.db.prepare(this.sql);
  }
  async all<T>() {
    return { results: this.stmt().all(...(this.params as any[])) as T[], success: true, meta: {} };
  }
  async first<T>() {
    const row = this.stmt().get(...(this.params as any[]));
    return (row ?? null) as T | null;
  }
  async run() {
    const info = this.stmt().run(...(this.params as any[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export function createTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  }
  const counter = { queries: 0 };
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql, counter),
    batch: async (stmts: Statement[]) => Promise.all(stmts.map((s) => s.run())),
    raw: db,
    counter,
  };
  return d1 as unknown as D1Database & { raw: DatabaseSync; counter: { queries: number } };
}
