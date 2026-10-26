// The database. We use Turso (libSQL, which is SQLite) on Vercel. The code below
// keeps the small D1-style API our queries were written for (prepare / bind / first /
// all / run / batch), so the SQL in the rest of the app did not have to change.
import { createClient, type Client, type InValue, type ResultSet } from "@libsql/client";

export interface RunResult {
  success: true;
  meta: { changes: number };
}

export interface AllResult<T> {
  results: T[];
  success: true;
  meta: { changes: number };
}

class Statement {
  private args: InValue[] = [];

  constructor(
    private client: Client,
    private sql: string,
  ) {}

  bind(...params: unknown[]): Statement {
    const s = new Statement(this.client, this.sql);
    // Missing values are stored as NULL, the same as D1 does.
    s.args = params.map((p) => (p === undefined ? null : (p as InValue)));
    return s;
  }

  /** @internal Used by batch(). */
  toQuery() {
    return { sql: this.sql, args: this.args };
  }

  async all<T = Record<string, unknown>>(): Promise<AllResult<T>> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return { results: toObjects<T>(rs), success: true, meta: { changes: Number(rs.rowsAffected) } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return (toObjects<T>(rs)[0] as T | undefined) ?? null;
  }

  async run(): Promise<RunResult> {
    const rs = await this.client.execute({ sql: this.sql, args: this.args });
    return { success: true, meta: { changes: Number(rs.rowsAffected) } };
  }
}

/** Turns libSQL rows (arrays with names) into plain objects, like D1 returns them. */
function toObjects<T>(rs: ResultSet): T[] {
  return rs.rows.map((row) => Object.fromEntries(rs.columns.map((name, i) => [name, row[i]]))) as T[];
}

export interface Db {
  prepare(sql: string): Statement;
  /** Runs statements in one transaction: all of them work, or none do. */
  batch(statements: Statement[]): Promise<RunResult[]>;
}

export function createDb(client: Client): Db {
  return {
    prepare: (sql: string) => new Statement(client, sql),
    async batch(statements: Statement[]) {
      const results = await client.batch(
        statements.map((s) => s.toQuery()),
        "write",
      );
      return results.map((rs) => ({ success: true as const, meta: { changes: Number(rs.rowsAffected) } }));
    },
  };
}

let cached: Db | null = null;

/** One database connection per server instance. Local runs use a file; Vercel uses Turso. */
export function getDb(url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN): Db {
  if (!url && process.env.VERCEL) throw new Error("TURSO_DATABASE_URL is not set in this Vercel environment");
  if (!cached) cached = createDb(createClient({ url: url ?? "file:.data/local.db", authToken }));
  return cached;
}
