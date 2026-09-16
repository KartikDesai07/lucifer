import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// CR1.1's whole point is that the floor plan is DATA (the live Table
// collection), not a compile-time list. TABLE_NUMBERS survives only as the
// empty-DB seed default. This is a grep-pin (mirrors the technique in
// apps/hub/lib/hotadd-plan.test.ts's cafe-source parity checks): it walks the
// real source tree with readFileSync so a NEW runtime consumer of
// TABLE_NUMBERS fails the suite instead of silently re-freezing the floor plan.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Every workspace that can import @pos/shared, not just this one — a consumer
// added in the hub, the failover worker or a root ops script would re-freeze the
// floor plan just as effectively as one added here, and this is the only pin.
const SCAN_ROOTS = [
  "packages/shared/src",
  "apps/cafe/app",
  "apps/cafe/components",
  "apps/cafe/hooks",
  "apps/cafe/lib",
  "apps/cafe/models",
  "apps/cafe/scripts",
  "apps/hub",
  "workers",
  "scripts",
];

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE_PATTERN = /\.test\.ts$/;
const TABLE_NUMBERS_IDENTIFIER = /\bTABLE_NUMBERS\b/;

// The only two files allowed to mention the identifier, expressed as
// repo-relative POSIX paths (declaration + its lone empty-DB-bootstrap consumer).
const ALLOWED_FILES = new Set([
  "packages/shared/src/constants.ts",
  "apps/cafe/scripts/seed-tables.ts",
]);

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, out);
    } else if (CODE_FILE_PATTERN.test(entry) && !TEST_FILE_PATTERN.test(entry)) {
      out.push(abs);
    }
  }
}

function findTableNumbersConsumers(): string[] {
  const offenders: string[] = [];
  for (const root of SCAN_ROOTS) {
    const rootAbs = path.join(REPO_ROOT, root);
    // A workspace may legitimately not exist yet (the failover worker is
    // undeployed); a missing root must not fail the pin.
    if (!existsSync(rootAbs)) continue;
    const files: string[] = [];
    walk(rootAbs, files);
    for (const fileAbs of files) {
      const rel = path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
      if (ALLOWED_FILES.has(rel)) continue;
      const src = readFileSync(fileAbs, "utf8");
      if (TABLE_NUMBERS_IDENTIFIER.test(src)) {
        offenders.push(rel);
      }
    }
  }
  return offenders;
}

test("PIN: the ONLY files mentioning TABLE_NUMBERS are the shared declaration and the seed-tables bootstrap — a new consumer would re-freeze the floor plan (tableNo is validated against the live Table collection now)", () => {
  const offenders = findTableNumbersConsumers();
  assert.deepEqual(
    offenders,
    [],
    `TABLE_NUMBERS must not gain a new runtime consumer — found it referenced in: ${offenders.join(", ")}. ` +
      `tableNo is validated against the live Table collection now (CR1.1), so a new TABLE_NUMBERS ` +
      `consumer would re-freeze the floor plan back to a compile-time list.`,
  );
});

test("PIN: order.schema.ts no longer hardcodes tableNo as z.enum(TABLE_NUMBERS) — the regression CR1.1 exists to prevent", () => {
  const src = readFileSync(path.join(REPO_ROOT, "packages/shared/src/schemas/order.schema.ts"), "utf8");
  assert.ok(
    !src.includes("z.enum(TABLE_NUMBERS)"),
    "order.schema.ts must not go back to validating tableNo against the frozen TABLE_NUMBERS list",
  );
});
