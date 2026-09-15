/**
 * Client import-graph guard (2026-09-14 /pos incident).
 *
 * A "use client" module — and everything it VALUE-imports, transitively — is
 * shipped to the browser. A Mongoose model there is fatal at module evaluation
 * (`mongoose.models` is undefined in the browser build → "Cannot read
 * properties of undefined (reading 'Customer')"), and node:test cannot see it:
 * the whole suite was green while every /pos load crashed, because in Node the
 * same import resolves fine. So this pin walks the REAL import graph from every
 * client component/hook and fails on any chain that reaches apps/cafe/models/*
 * or lib/db.ts. The chain that bit us was four hops deep
 * (pos/page → use-pos-tab → use-customer-rewards → reward-rungs → reward-claim →
 * models/Customer), which is why this is a transitive walk and not a grep of
 * direct imports.
 *
 * `import type …` and `import { type A, type B } …` are erased by the compiler
 * (isolatedModules, no verbatimModuleSyntax) and are ignored; comments are
 * stripped first so a quoted import in a doc comment cannot false-positive.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["app", "components", "hooks", "lib"];
const SKIP_DIRS = new Set(["node_modules", ".next", "scripts"]);
const SOURCE_EXTS = [".ts", ".tsx"];
// Server-only by construction: a client chain must never reach these.
// `mongoose` itself joins models/ and lib/db.ts: it resolves to a browser build
// rather than crashing, so a client VALUE import of it fails SILENTLY — it just
// ships the whole driver in the bundle. Added CB-5B session 38, after
// components/pos/VoidItemDialog.tsx -> lib/order-void.ts -> `import { Types }
// from "mongoose"` was found doing exactly that (fixed by splitting the
// client-safe rule out into lib/order-void-rules.ts).
const SERVER_ONLY = /(^|\/)models\/|\/lib\/db\.ts$/;
// Bare PACKAGE specifiers that must never be value-imported from the client
// graph. Kept separate from SERVER_ONLY above because that regex is tested
// against a RESOLVED file path, and resolveSpecifier() returns null for a bare
// package — so a package name added there would be dead code, never evaluated.
// `mongoose` fails SILENTLY rather than crashing: it resolves to a browser build
// and just ships the whole driver in the bundle. Added CB-5B session 38, after
// components/pos/VoidItemDialog.tsx -> lib/order-void.ts -> `import { Types }
// from "mongoose"` was found doing exactly that (fixed by splitting the
// client-safe rule out into lib/order-void-rules.ts).
const SERVER_ONLY_PACKAGES = new Set(["mongoose"]);
const USE_CLIENT_RE = /^\s*["']use client["']/m;
const DIRECTIVE_WINDOW = 400; // the directive must be at the top of the file
// Vision guards — the scan must be looking at the real tree.
const MIN_CLIENT_MODULES = 150;
const LANDMARK_FROM = "hooks/use-customer-rewards.ts";
const LANDMARK_TO = "lib/reward-rungs.ts";

const IMPORT_RE =
  /import\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|export\s+(type\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']/g;

function rel(file: string): string {
  return path.relative(CAFE_ROOT, file).replace(/\\/g, "/");
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXTS.some((ext) => entry.name.endsWith(ext)) && !entry.name.includes(".test.")) out.push(full);
  }
  return out;
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(CAFE_ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package — not part of the cafe graph
  const candidates = [base, ...SOURCE_EXTS.map((e) => base + e), ...SOURCE_EXTS.map((e) => path.join(base, `index${e}`))];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function onlyTypeSpecifiers(clause: string): boolean {
  if (!clause.startsWith("{")) return false;
  const names = clause.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean);
  return names.length > 0 && names.every((n) => n.startsWith("type "));
}

/** Specifiers this module imports/re-exports as VALUES (what the bundler follows). */
export function valueImportSpecifiers(source: string): string[] {
  const src = stripComments(source);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const typeOnly = Boolean(m[1] || m[5]);
    const clause = m[2] ?? m[6] ?? "";
    const spec = m[3] ?? m[4] ?? m[7];
    if (!spec || typeOnly || onlyTypeSpecifiers(clause)) continue;
    out.push(spec);
  }
  return out;
}

interface Graph {
  clientFiles: string[];
  edges: Set<string>; // "from → to" (relative)
  leaks: string[]; // human-readable chains
}

function scan(): Graph {
  const files = SCAN_DIRS.flatMap((d) => (existsSync(path.join(CAFE_ROOT, d)) ? walk(path.join(CAFE_ROOT, d), []) : []));
  const clientFiles = files.filter((f) => USE_CLIENT_RE.test(readFileSync(f, "utf8").slice(0, DIRECTIVE_WINDOW)));
  const edges = new Set<string>();
  const leaks = new Set<string>();
  for (const entry of clientFiles) {
    const parent = new Map<string, string | null>([[entry, null]]);
    const queue = [entry];
    const chainOf = (file: string): string => {
      const parts: string[] = [];
      let cursor: string | null | undefined = file;
      while (cursor) {
        parts.unshift(rel(cursor));
        cursor = parent.get(cursor) ?? null;
      }
      return parts.join(" → ");
    };
    while (queue.length > 0) {
      const file = queue.shift() as string;
      for (const spec of valueImportSpecifiers(readFileSync(file, "utf8"))) {
        if (SERVER_ONLY_PACKAGES.has(spec)) {
          leaks.add(`${chainOf(file)} → ${spec} (package)`);
        }
        const resolved = resolveSpecifier(spec, file);
        if (!resolved) continue;
        edges.add(`${rel(file)} → ${rel(resolved)}`);
        if (SERVER_ONLY.test(resolved.replace(/\\/g, "/"))) {
          leaks.add(`${chainOf(file)} → ${rel(resolved)}`);
          continue;
        }
        if (!parent.has(resolved)) {
          parent.set(resolved, file);
          queue.push(resolved);
        }
      }
    }
  }
  return { clientFiles, edges, leaks: [...leaks] };
}

test("no 'use client' module reaches a Mongoose model or lib/db through value imports (transitive)", () => {
  const graph = scan();
  assert.ok(graph.clientFiles.length >= MIN_CLIENT_MODULES, `vision guard: only ${graph.clientFiles.length} client modules found — is the scan looking at the tree?`);
  assert.ok(graph.edges.has(`${LANDMARK_FROM} → ${LANDMARK_TO}`), `vision guard: expected the edge ${LANDMARK_FROM} → ${LANDMARK_TO} in the client graph`);
  assert.deepEqual(graph.leaks, [], `server-only modules reachable from the browser bundle:\n  ${graph.leaks.join("\n  ")}`);
});

test("reward-rungs.ts reads the claim copy from the pure message module, never from the model-bearing reward-claim.ts", () => {
  const src = readFileSync(path.join(CAFE_ROOT, "lib/reward-rungs.ts"), "utf8");
  const specs = valueImportSpecifiers(src);
  assert.ok(src.includes("export function rungOffers"), "landmark: reward-rungs.ts still exports rungOffers");
  assert.ok(specs.includes("@/lib/reward-claim-messages"), "reward-rungs.ts must import rewardClaimMessage from @/lib/reward-claim-messages");
  assert.equal(specs.includes("@/lib/reward-claim"), false, "reward-rungs.ts must not value-import @/lib/reward-claim (it imports Mongoose models)");
  // And the message module itself must stay import-free — that is what makes it safe from both sides.
  const messages = readFileSync(path.join(CAFE_ROOT, "lib/reward-claim-messages.ts"), "utf8");
  assert.ok(messages.includes("export function rewardClaimMessage"), "landmark: the message module exports rewardClaimMessage");
  assert.deepEqual(valueImportSpecifiers(messages), [], "lib/reward-claim-messages.ts must import nothing");
});

test("value-import parser: type-only imports are erased, quoted imports in comments are ignored", () => {
  const sample = [
    `import type { A } from "@/models/A";`,
    `import { type B, type C } from "@/models/B";`,
    `// import { Table } from "@/models/Table"`,
    `/* import { X } from "@/models/X" */`,
    `import { real } from "@/lib/real";`,
    `import { type D, value } from "./mixed";`,
    `export type { E } from "@/models/E";`,
    `export { f } from "./reexport";`,
    `import "./side-effect";`,
  ].join("\n");
  assert.deepEqual(valueImportSpecifiers(sample), ["@/lib/real", "./mixed", "./reexport", "./side-effect"]);
});
