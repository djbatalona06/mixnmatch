// MPES checks: the parts of docs/mpes/05-engineering-standards.md a machine can check.
// Each test names the rule it guards. They read files only: no network, no database.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(dir, root), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(path, ext));
    else if (ext.test(entry.name)) out.push(path);
  }
  return out;
}

function trackedFiles(): string[] | null {
  try {
    return execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    return null; // not a git checkout (e.g. a downloaded zip): nothing to check
  }
}

describe("MPES security rules", () => {
  const tracked = trackedFiles();

  it.skipIf(!tracked)("SEC-06: no secrets or local databases are saved in git", () => {
    const forbidden = [
      /(^|\/)\.env(?!\.example$)(\..*)?$/, // .env, .env.local … but not .env.example
      /(^|\/)\.dev\.vars$/,
      /(^|\/)\.wrangler\//,
      /(^|\/)\.data\//,
      /\.(db|sqlite|sqlite3)(-shm|-wal)?$/,
    ];
    const bad = tracked!.filter((file) => forbidden.some((pattern) => pattern.test(file)));
    expect(bad).toEqual([]);
  });

  it("SEC-05: no HTML injection or code-from-text in the app or the server", () => {
    const code = [...filesUnder("src", /\.ts$/), ...filesUnder("app/src", /\.tsx?$/), "api/[...path].ts"];
    for (const file of code) {
      const text = read(file);
      expect(text, file).not.toMatch(/dangerouslySetInnerHTML|\beval\s*\(|new Function\s*\(/);
    }
  });
});

describe("MPES data rules", () => {
  it("DATA-01: migrations are numbered 0001, 0002, … with no gaps or repeats", () => {
    const files = readdirSync(new URL("migrations", root)).filter((f) => f.endsWith(".sql")).sort();
    expect(files.length).toBeGreaterThan(0);
    files.forEach((file, i) => {
      expect(file, file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
      expect(Number(file.slice(0, 4)), file).toBe(i + 1);
    });
  });
});

describe("MPES operations rules", () => {
  it("OPS-01: every setting the server reads is listed in .env.example", () => {
    const envFile = read("src/env.ts");
    const body = envFile.slice(envFile.indexOf("export interface Env"), envFile.indexOf("}", envFile.indexOf("export interface Env")));
    const names = [...body.matchAll(/^\s+([A-Z][A-Z0-9_]+)\??:/gm)].map((m) => m[1]).filter((n) => n !== "DB");
    const example = read(".env.example");
    expect(names.length).toBeGreaterThan(5);
    for (const name of names) expect(example, name).toMatch(new RegExp(`^${name}=`, "m"));
  });

  it("DEP-01: the app ships with 12 or fewer runtime libraries", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(Object.keys(pkg.dependencies).length).toBeLessThanOrEqual(12);
  });
});

describe("MPES docs rules", () => {
  it("DOC-01: every MPES document starts with an 'In plain words' box", () => {
    const docs = readdirSync(new URL("docs/mpes", root)).filter((f) => f.endsWith(".md"));
    expect(docs.length).toBe(8);
    for (const doc of docs) expect(read(`docs/mpes/${doc}`), doc).toContain("> **In plain words**");
  });
});
