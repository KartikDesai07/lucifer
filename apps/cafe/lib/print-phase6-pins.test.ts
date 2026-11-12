/**
 * Printing Phase 6 scope pins (spec §9 rulings 4, 26, 28): Phase 6 stays inside its rules. The agent sends no new
 * kind of request, starts no new timer, the two writers that carry the S1 pin are untouched, the shared budget test
 * is untouched, and nothing but tests imports the scenario world.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { stripComments } from "@/lib/source-pin-utils";

const cafe = process.cwd();
const repo = path.join(cafe, "..", "..");

/** sha256 of packages/shared/src/print-budget.test.ts at main 0c794d6. */
const PRINT_BUDGET_TEST_SHA256 = "8a92260e1273d3a9af5718b18d5c5cf36f5d2ea2a24b1c4430a9ec2a27f83502";

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}


function code(rel: string): string {
  return stripComments(readFileSync(path.join(cafe, rel), "utf8"));
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const AGENT_FILES = [
  ...readdirSync(path.join(cafe, "lib")).filter((n) => /^print-(agent|line|lines)[^/]*\.ts$/.test(n) && !/\.test\./.test(n)).map((n) => `lib/${n}`),
  "hooks/use-print-agent.ts",
];

const PHASE6_FILES = [
  "lib/printer/lane-writes.ts",
  "lib/print-host-tickets.ts",
  "lib/print-lines.ts",
  "lib/print-line-job.ts",
  "lib/print-agent-print.ts",
  "lib/print-copies.ts",
];

test("nothing imports the scenario world but tests", () => {
  const world = /from\s+["'][^"']*print-lines-(world-clock|world|rig)["']/;
  const own = /print-lines-(world-clock|world|rig)\.ts$/;
  const offenders: string[] = [];
  let scanned = 0;
  for (const dir of ["app", "components", "hooks", "lib"]) {
    for (const file of walk(path.join(cafe, dir), [])) {
      if (/\.test\.tsx?$/.test(file) || own.test(file)) continue;
      scanned += 1;
      if (world.test(readFileSync(file, "utf8"))) offenders.push(path.relative(cafe, file));
    }
  }
  assert.ok(scanned > 100, `the walk saw the non-test files (${scanned})`);
  assert.deepEqual(offenders, [], "no non-test file imports the scenario world, its clock or its rig");
});

test("lane-print.ts and desktop-shell.ts are untouched", () => {
  const table = readFileSync(path.join(cafe, "lib/printer/kot-text/text-kot-print.test.ts"), "utf8");
  for (const file of ["apps/cafe/lib/printer/lane-print.ts", "apps/cafe/lib/desktop-shell.ts"]) {
    const at = table.indexOf(`"${file}"`);
    assert.ok(at >= 0, `${file} is in the PIN (S1) table`);
    const m = /^"\s*,\s*"([0-9a-f]{64})"/.exec(table.slice(at + file.length + 1));
    assert.ok(m, `${file} has a sha256 entry in the table`);
    assert.equal(sha256(path.join(repo, file)), m[1], `${file} equals its PIN (S1) hash`);
  }
});

test("print-budget.test.ts is untouched", () => {
  assert.equal(sha256(path.join(repo, "packages/shared/src/print-budget.test.ts")), PRINT_BUDGET_TEST_SHA256, "the shared budget test is byte for byte as at 0c794d6");
});

test("the agent makes no new kind of request", () => {
  assert.ok(AGENT_FILES.length >= 15, `the agent files were found (${AGENT_FILES.length})`);
  const sites: string[] = [];
  for (const rel of AGENT_FILES) {
    const src = code(rel);
    for (const m of src.matchAll(/apiSend\s*(?:<[^>(]*>)?\s*\(\s*([^,]+),/g)) sites.push(`${rel} ${m[1].trim()}`);
    assert.equal(/\bapiSend\b/.test(src.replace(/apiSend\s*(?:<[^>(]*>)?\s*\(/g, "")) && !/import[^;]*apiSend/.test(src), false, `${rel} names apiSend only as an import or a call`);
  }
  assert.deepEqual(sites.sort(), [
    "hooks/use-print-agent.ts LEASE_URL",
    "hooks/use-print-agent.ts `/api/print-jobs/${encodeURIComponent(id)}/ack`",
  ].sort(), "the only apiSend calls are the lease and the ack");
  for (const rel of [...AGENT_FILES, ...PHASE6_FILES]) {
    assert.doesNotMatch(code(rel), /\bfetch\s*\(|XMLHttpRequest|EventSource|WebSocket/, `${rel} opens no new channel`);
  }
});

test("no new timer", () => {
  for (const rel of PHASE6_FILES) {
    assert.ok(statSync(path.join(cafe, rel)).isFile(), `${rel} exists`);
    assert.doesNotMatch(code(rel), /\b(setTimeout|setInterval|setImmediate)\s*\(/, `${rel} starts no timer of its own`);
  }
  assert.match(code("lib/print-agent-print.ts"), /setTimer/, "the agent's one timer is its deps' setTimer");
});
