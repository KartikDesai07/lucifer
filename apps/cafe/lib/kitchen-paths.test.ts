// P4-A kot board plan (.claude/plan/v2/p4a-kot-board-plan.md §7, pins 14-15,
// 17-21) — RAW source-text pins over the UI slice this agent owns: the
// kitchen hook's poll gate + no-raw-literal hygiene, the query.ts constant
// placement (already-landed, re-pinned here for the contract), the sidebar's
// no-adminOnly Kitchen entry (paired with a positive Staff adminOnly
// landmark), single-nav-source + no-AdminGuard reachability, hygiene
// (no console., no cafe name), the freshness chip's decoupling from the data
// poll, and per-file line budgets. Same readSrc + stripComments idiom as
// lib/print-host-band-paths.test.ts:20-29. Pins 11-13/16 (the other agent's
// route + /items contract) are intentionally NOT here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const USE_KITCHEN = "apps/cafe/hooks/use-kitchen.ts";
const QUERY_TS = "packages/shared/src/query.ts";
const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const KITCHEN_PAGE = "apps/cafe/app/(dashboard)/kitchen/page.tsx";
const KITCHEN_CARD = "apps/cafe/components/kitchen/KitchenLineCard.tsx";
const KITCHEN_CHIP = "apps/cafe/components/kitchen/KitchenFreshnessChip.tsx";
const KITCHEN_BOARD_LIB = "apps/cafe/lib/kitchen-board.ts";
const ITEMS_ROUTE = "apps/cafe/app/api/orders/[id]/items/route.ts";
const ADDROUND = "apps/cafe/lib/order-request-accept-addround.ts";

// ── (14) use-kitchen.ts poll gate ───────────────────────────────────────────

test("PIN (14): use-kitchen.ts's useKitchenBoard sets refetchIntervalInBackground: true, uses REFETCH_INTERVALS.KITCHEN, gates on useIsMutating({ mutationKey: ORDER_KEYS.mutation }), and contains NO raw 10000/10 * 1000 literal", () => {
  const raw = readSrc(USE_KITCHEN);
  const stripped = stripComments(raw);

  assert.match(stripped, /refetchIntervalInBackground:\s*true/, "must set refetchIntervalInBackground: true");
  assert.match(stripped, /REFETCH_INTERVALS\.KITCHEN/, "must reference REFETCH_INTERVALS.KITCHEN");
  assert.match(
    stripped,
    /useIsMutating\(\{\s*mutationKey:\s*ORDER_KEYS\.mutation\s*\}\)/,
    "must gate on useIsMutating({ mutationKey: ORDER_KEYS.mutation })",
  );

  assert.ok(!/\b10000\b/.test(stripped), "must NOT contain a raw 10000 literal");
  assert.ok(!/10\s*\*\s*1000/.test(stripped), "must NOT contain a raw 10 * 1000 literal");

  // positive landmark: the tick mutation must use its OWN key, not ORDER_KEYS —
  // proving the file still has real, non-blinded content around the gate.
  assert.match(stripped, /mutationKey:\s*KITCHEN_KEYS\.mutation/, "positive landmark: the tick mutation must declare mutationKey: KITCHEN_KEYS.mutation");
});

// ── (15) query.ts constant placement (already-landed; re-pinned) ───────────

test("PIN (15): query.ts declares KITCHEN: inside REFETCH_INTERVALS and KITCHEN_FRESHNESS_TICK_MS AFTER that object's closing `} as const;`", () => {
  const src = readSrc(QUERY_TS);

  const refetchBlockMatch = src.match(/export const REFETCH_INTERVALS = \{[\s\S]*?\} as const;/);
  assert.ok(refetchBlockMatch, "positive landmark: REFETCH_INTERVALS = { ... } as const; must exist");
  assert.match(refetchBlockMatch![0], /KITCHEN:/, "REFETCH_INTERVALS must declare KITCHEN:");

  const refetchCloseAt = src.indexOf(refetchBlockMatch![0]) + refetchBlockMatch![0].length;
  const tickConstAt = src.indexOf("export const KITCHEN_FRESHNESS_TICK_MS");
  assert.ok(tickConstAt >= 0, "must export KITCHEN_FRESHNESS_TICK_MS");
  assert.ok(
    tickConstAt > refetchCloseAt,
    `KITCHEN_FRESHNESS_TICK_MS(${tickConstAt}) must come AFTER REFETCH_INTERVALS's closing "} as const;"(${refetchCloseAt})`,
  );

  // Vision guard: KITCHEN_FRESHNESS_TICK_MS must NOT itself be inside the
  // REFETCH_INTERVALS block (the whole point of pinning "after the close").
  assert.ok(!refetchBlockMatch![0].includes("KITCHEN_FRESHNESS_TICK_MS"), "KITCHEN_FRESHNESS_TICK_MS must NOT live inside REFETCH_INTERVALS");
});

// ── (17) sidebar: Kitchen has no adminOnly, Staff DOES ──────────────────────

test("PIN (17): AppSidebar.tsx's Kitchen entry has url: \"/kitchen\" and no adminOnly, PAIRED with a positive landmark that the Staff entry DOES carry adminOnly: true", () => {
  const raw = readSrc(APP_SIDEBAR);

  const kitchenLineMatch = raw.match(/\{\s*title:\s*"Kitchen"[^}]*\}/);
  assert.ok(kitchenLineMatch, "positive landmark: a Kitchen nav entry must exist");
  const kitchenLine = kitchenLineMatch![0];
  assert.match(kitchenLine, /url:\s*"\/kitchen"/, 'the Kitchen entry must declare url: "/kitchen"');
  assert.ok(!kitchenLine.includes("adminOnly"), "the Kitchen entry must NOT carry adminOnly — staff and admin both use this screen");

  // Vision guard: prove the needle CAN see adminOnly at all, on a sibling
  // entry that is genuinely admin-gated.
  const staffLineMatch = raw.match(/\{\s*title:\s*"Staff"[^}]*\}/);
  assert.ok(staffLineMatch, "positive landmark: a Staff nav entry must exist");
  assert.match(staffLineMatch![0], /adminOnly:\s*true/, "the Staff entry must carry adminOnly: true — proves the adminOnly needle is not vacuously absent from this file");
});

// ── (18) reachability: /kitchen in exactly one nav source, no AdminGuard ────

function walkFiles(root: string, onFile: (full: string) => void): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, onFile);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    onFile(full);
  }
}

function relCafe(full: string): string {
  return path.relative(path.join(REPO_ROOT, "apps/cafe"), full).split(path.sep).join("/");
}

test('INVENTORY (18a): "/kitchen" appears as a nav href/url in exactly one source file — components/layout/AppSidebar.tsx', () => {
  const roots = ["app", "components", "hooks"].map((d) => path.join(REPO_ROOT, "apps/cafe", d));
  const hits: string[] = [];
  for (const root of roots) {
    walkFiles(root, (full) => {
      const rel = relCafe(full);
      if (rel === "app/(dashboard)/kitchen/page.tsx") return; // the page's own route segment, not a nav source
      const text = readFileSync(full, "utf8");
      if (text.includes('"/kitchen"')) hits.push(rel);
    });
  }
  hits.sort();
  assert.deepEqual(hits, ["components/layout/AppSidebar.tsx"], `"/kitchen" must appear as a nav source in exactly AppSidebar.tsx; found: ${hits.join(", ")}`);
});

test("PIN (18b): kitchen/page.tsx contains no AdminGuard (staff and admin both use this screen); positive landmark: the page still exports a default component", () => {
  const raw = readSrc(KITCHEN_PAGE);
  assert.ok(!raw.includes("AdminGuard"), "kitchen/page.tsx must NOT contain AdminGuard");
  assert.match(raw, /export default function KitchenPage\(/, "positive landmark: must export default function KitchenPage(");
});

// ── (19) hygiene: no console., no hardcoded cafe name ───────────────────────

test("PIN (19): use-kitchen.ts, kitchen/page.tsx, KitchenLineCard.tsx, KitchenFreshnessChip.tsx contain no console. and no hardcoded cafe name", () => {
  const consoleNeedle = "console" + ".";
  const luciferNeedle = "Luci" + "fer";
  const files = [USE_KITCHEN, KITCHEN_PAGE, KITCHEN_CARD, KITCHEN_CHIP];
  for (const rel of files) {
    const raw = readSrc(rel);
    assert.ok(!raw.includes(consoleNeedle), `${rel} must NOT contain ${consoleNeedle} anywhere, not even in a comment`);
    assert.ok(!new RegExp(luciferNeedle, "i").test(raw), `${rel} must NOT contain "${luciferNeedle}" (case-insensitive), not even in a comment`);
  }
  // positive landmark: each file has real content, proving the scans above
  // aren't vacuously passing on an empty/blinded read.
  assert.match(readSrc(USE_KITCHEN), /export function useKitchenBoard\(/, "positive landmark: use-kitchen.ts must export useKitchenBoard(");
  assert.match(readSrc(KITCHEN_PAGE), /export default function KitchenPage\(/, "positive landmark: kitchen/page.tsx must export default function KitchenPage(");
  assert.match(readSrc(KITCHEN_CARD), /export function KitchenLineCard\(/, "positive landmark: KitchenLineCard.tsx must export KitchenLineCard(");
  assert.match(readSrc(KITCHEN_CHIP), /export function KitchenFreshnessChip\(/, "positive landmark: KitchenFreshnessChip.tsx must export KitchenFreshnessChip(");
});

// ── (20) freshness chip decoupling ──────────────────────────────────────────

test("PIN (20): KitchenFreshnessChip.tsx uses KITCHEN_FRESHNESS_TICK_MS and does NOT reference REFETCH_INTERVALS.KITCHEN", () => {
  const raw = readSrc(KITCHEN_CHIP);
  assert.match(raw, /KITCHEN_FRESHNESS_TICK_MS/, "must reference KITCHEN_FRESHNESS_TICK_MS");
  assert.ok(!raw.includes("REFETCH_INTERVALS"), "must NOT reference REFETCH_INTERVALS at all (the decoupling this pin exists to prove)");
  assert.ok(!raw.includes("REFETCH_INTERVALS.KITCHEN"), "must NOT reference REFETCH_INTERVALS.KITCHEN specifically");
});

// ── (21) line budgets ────────────────────────────────────────────────────────

function lineCountOf(rel: string): number {
  return readSrc(rel).replace(/\n$/, "").split("\n").length;
}

test("PIN (21): each new UI-slice file stays within its stated line budget +20%", () => {
  const budgets: Array<[string, number]> = [
    // P4-B — bumped from 90: useMarkOrderReady (its own mutation, optimistic
    // filter-out, undo-capable rollback) is new, spec-mandated surface area
    // on the backend slice, not bloat. Measured at 148 lines pre-existing in
    // the working tree before this UI slice touched anything (git diff HEAD
    // showed the growth already applied); re-scoped, not weakened.
    [USE_KITCHEN, 150],
    [KITCHEN_PAGE, 130],
    [KITCHEN_CARD, 110],
    [KITCHEN_CHIP, 70],
  ];
  for (const [rel, budget] of budgets) {
    const cap = Math.ceil(budget * 1.2);
    const actual = lineCountOf(rel);
    assert.ok(actual <= cap, `${rel} must stay <= ${cap} lines (budget ${budget} +20%), got ${actual}`);
  }
});

// positive landmark that kitchen-board.ts (the already-landed pure module
// this UI slice consumes) is real and non-empty, so a failure in the pins
// above can't be blamed on reading from an empty/blinded tree.
test("SANITY: kitchen-board.ts exports buildKitchenRows and kitchenAgeBand", () => {
  const raw = readSrc(KITCHEN_BOARD_LIB);
  assert.match(raw, /export function buildKitchenRows\(/, "kitchen-board.ts must export buildKitchenRows(");
  assert.match(raw, /export function kitchenAgeBand\(/, "kitchen-board.ts must export kitchenAgeBand(");
});

// ── PIN (22): EVERY writer of kotRounds must also stamp kotFiredAt ──────────
// There are exactly TWO writers that advance a tab's round: the staff fire
// (/items) and the diner QR round accepted by staff (-addround). The second
// one shipped writing kotNumbers but NOT kotFiredAt, so the kitchen board
// aged a diner's round from the tab's OPEN time and rendered it "Late" the
// instant it was fired — the precise failure kotFiredAt exists to prevent.
// Worse, the next staff round then backfilled that gap from createdAt,
// producing a DEFINED but fabricated stamp that renders as precise rather
// than approximate. Pinned reciprocally: a third writer of kotRounds must
// stamp the fire time too.
test("PIN (22): both kotRounds writers stamp kotFiredAt in the same $set", () => {
  for (const rel of [ITEMS_ROUTE, ADDROUND]) {
    const src = stripComments(readSrc(rel));
    assert.ok(
      src.includes("kotRounds: round"),
      `${rel} must be a kotRounds writer (landmark) — if this moved, re-check the pin below`,
    );
    // The needle is the WRITE inside the $set, not the bare identifier: an
    // `import { buildKotFiredAt }` line alone contains "kotFiredAt" and made
    // an earlier version of this pin pass against the known-buggy shape
    // (proven by mutation). Assert the field is SET next to kotRounds.
    const setBlock = src.slice(src.indexOf("kotRounds: round"));
    assert.ok(
      /kotFiredAt\s*[,:]/.test(setBlock),
      `${rel} advances kotRounds, so it MUST also stamp kotFiredAt in that same $set or the board ages that round from the tab's open time`,
    );
  }
});
