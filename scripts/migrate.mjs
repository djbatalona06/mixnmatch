// Applies the database changes in migrations/ that have not run yet.
// Vercel runs this on every build (see "buildCommand" in vercel.json).
// By hand: npm run db:migrate   (uses TURSO_DATABASE_URL, or a local file if it is not set)
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createClient } from "@libsql/client";

const url = process.env.TURSO_DATABASE_URL;
if (!url && process.env.VERCEL) throw new Error("TURSO_DATABASE_URL is not set in this Vercel environment");
const localFile = url ?? "file:.data/local.db";
if (localFile.startsWith("file:")) mkdirSync(".data", { recursive: true });

const client = createClient({ url: localFile, authToken: process.env.TURSO_AUTH_TOKEN });
await client.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");

const applied = new Set((await client.execute("SELECT name FROM schema_migrations")).rows.map((row) => String(row[0])));
const files = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`applying ${file}`);
  await client.executeMultiple(readFileSync(`migrations/${file}`, "utf8"));
  await client.execute({ sql: "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)", args: [file, Date.now()] });
}

console.log(`database is up to date (${files.length} migration files)`);
client.close();
