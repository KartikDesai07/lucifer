// Print-host plan (.claude/plan/v2/print-host-plan.md §B1/§B5, slice PH-5) —
// DB-free unit tests over the PURE adapter lib/print-host-slips.ts: turning a
// claimed job's payload back into the exact renderer props the local lane
// (hooks/use-pos-print.ts) synthesizes, so a host-printed slip and a
// locally-printed one are the same paper. Zero React, zero DB, zero fetch —
// every builder here is a plain function over its payload/order fixture.
//
// Style/idiom follows lib/pos-pulse-paths.test.ts and lib/print-routing.test.ts:
// readSrc + REPO_ROOT resolution for the one parity pin at the bottom (no
// stripComments — testing.md's banned-string scans read raw bytes, comments
// included, so a source-text pin never strips them either).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  orderFromSnapshot,
  kotRoundSlip,
  hostPrintSlipOf,
  PRINT_HOST_DRAIN_LOCK_NAME,
  PRINT_HOST_DISPATCH_TIMEOUT_MS,
  PRINT_HOST_EMPTY_SLIP_MESSAGE,
  PRINT_HOST_EOD_READY_TIMEOUT_MS,
  PRINT_HOST_PRINT_FAILED_MESSAGE,
  type HostKotSlip,
} from "./print-host-slips";
import { DESKTOP_PRINT_TIMEOUT_MS } from "@/lib/desktop-shell";
import { PRINT_JOB_KINDS } from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { PrintOrderSnapshot } from "@pos/shared/print-job";
import type { Order } from "@/types";

// ── Fixtures ─────────────────────────────────────────────────────────────
// Two rounds: round 1 fired and ticketed (#101), round 2 fired with the
// route's own "not numbered" sentinel (0) — so orderFromSnapshot/kotRoundSlip
// exercise the exact zero-guard use-pos-print.ts's queueKotRound applies.

const ROUND1_ITEM = {
  productId: "p1",
  name: "Filter Coffee",
  price: 4000,
  qty: 2,
  variation: "Large",
  modifiers: ["Extra shot"],
  instructions: "No sugar",
  kotRound: 1,
};

const ROUND2_ITEM = {
  productId: "p2",
  name: "Masala Dosa",
  price: 6000,
  qty: 1,
  modifiers: [],
  instructions: "",
  kotRound: 2,
};

const SNAPSHOT: PrintOrderSnapshot = {
  _id: "665f0a0000000000000000a1",
  orderId: "ORD-0001",
  customerName: "Walk-in",
  items: [ROUND1_ITEM, ROUND2_ITEM],
  subtotal: 14000,
  discount: 0,
  total: 14000,
  paidAmount: 14000,
  payment: "Cash",
  status: "Completed",
  receiver: "Staff",
  tableNo: "T-4",
  kotRounds: 2,
  kotNumbers: [101, 0],
  createdAt: "2026-09-06T10:00:00.000Z",
};

function orderFixture(overrides: Partial<Order> = {}): Order {
  return { ...orderFromSnapshot(SNAPSHOT), ...overrides };
}

function assertKind<K extends PrintJobPayload["kind"]>(
  payload: PrintJobPayload,
  kind: K,
): asserts payload is Extract<PrintJobPayload, { kind: K }> {
  assert.equal(payload.kind, kind, `expected payload.kind === "${kind}"`);
}

// ── 1. orderFromSnapshot ─────────────────────────────────────────────────

test("UNIT: orderFromSnapshot spreads every snapshot field and adds updatedAt === createdAt (the one Order key the snapshot lacks, per the module header)", () => {
  const order = orderFromSnapshot(SNAPSHOT);
  for (const key of Object.keys(SNAPSHOT) as (keyof PrintOrderSnapshot)[]) {
    assert.deepEqual(order[key], SNAPSHOT[key], `orderFromSnapshot must carry over snapshot.${String(key)} verbatim`);
  }
  assert.equal(order.updatedAt, SNAPSHOT.createdAt, "updatedAt must equal createdAt — no renderer reads it");
});

// ── 2. kot round 1 ───────────────────────────────────────────────────────

test('PIN: kotRoundSlip round 1 — surface "kot", kotRoundItems is only round-1 items, kotRoundLabel "Round 1", kotRoundNumber 101, kotVariant "kot", documentTitle KOT-<orderId>, no void/moved fields', () => {
  const order = orderFixture();
  const slip = kotRoundSlip(order, 1) as HostKotSlip;
  assert.equal(slip.surface, "kot");
  assert.deepEqual(slip.kotRoundItems, [ROUND1_ITEM]);
  assert.equal(slip.kotRoundLabel, "Round 1");
  assert.equal(slip.kotRoundNumber, 101);
  assert.equal(slip.kotVariant, "kot");
  assert.equal(slip.documentTitle, `KOT-${order.orderId}`);
  for (const field of ["voidReason", "voidedBy", "voidedAt", "movedFrom", "movedBy", "movedAt"] as const) {
    assert.equal(slip[field], undefined, `round-1 kot slip must carry no ${field}`);
  }
});

// ── 3. kot round 2 with the 0 sentinel, and round 3 absent entirely ──────

test('PIN: kotRoundSlip round 2 — kotNumbers[1] is the route\'s 0 "not numbered" sentinel, so kotRoundNumber is undefined (mirrors use-pos-print.ts\'s queueKotRound > 0 guard, never "#0")', () => {
  const order = orderFixture();
  const slip = kotRoundSlip(order, 2) as HostKotSlip;
  assert.deepEqual(slip.kotRoundItems, [ROUND2_ITEM]);
  assert.equal(slip.kotRoundLabel, "Round 2");
  assert.equal(slip.kotRoundNumber, undefined, "the 0 sentinel must never surface as a real ticket number");
});

test("PIN: kotRoundSlip round 3 (no kotNumbers entry at all — order.kotNumbers has length 2) — kotRoundNumber is undefined, and kotRoundItems is an empty array (no round-3 items), not undefined", () => {
  const order = orderFixture();
  const slip = kotRoundSlip(order, 3) as HostKotSlip;
  assert.equal(slip.kotRoundNumber, undefined, "an out-of-range round index must never surface a ticket number");
  assert.deepEqual(slip.kotRoundItems, [], "no items were fired in round 3, so the filtered list is empty, not omitted");
});

// ── 4. kot round null (whole-tab reprint) ────────────────────────────────

test("PIN: kotRoundSlip round null (whole-tab reprint) — kotRoundItems, kotRoundLabel, kotRoundNumber ALL undefined (reprintKot's three resets), kotVariant \"kot\"", () => {
  const order = orderFixture();
  const slip = kotRoundSlip(order, null) as HostKotSlip;
  assert.equal(slip.kotRoundItems, undefined);
  assert.equal(slip.kotRoundLabel, undefined);
  assert.equal(slip.kotRoundNumber, undefined);
  assert.equal(slip.kotVariant, "kot");
  assert.equal(slip.documentTitle, `KOT-${order.orderId}`);
});

// ── 5. void ──────────────────────────────────────────────────────────────

test('PIN: hostPrintSlipOf void payload — kotRoundItems is exactly ONE item equal to the payload line minus kotNumber; kotRoundNumber = line.kotNumber; label "Round <line.kotRound>"; kotVariant "void"; voidReason/voidedBy/voidedAt from the payload (never the order\'s opener/open-time)', () => {
  const payload: PrintJobPayload = {
    kind: "void",
    snapshot: SNAPSHOT,
    line: {
      productId: "p1",
      name: "Filter Coffee",
      variation: "Large",
      price: 4000,
      qty: 1,
      modifiers: ["Extra shot"],
      instructions: "No sugar",
      kotRound: 1,
      kotNumber: 101,
    },
    reason: "Wrong order",
    voidedBy: "Manager",
    voidedAt: "2026-09-06T11:00:00.000Z",
  };
  const slip = hostPrintSlipOf(payload, "2026-09-06");
  assert.equal(slip.surface, "kot");
  assertKind(payload, "void");
  const { kotNumber, ...lineWithoutNumber } = payload.line;
  if (slip.surface !== "kot") throw new Error("unreachable — asserted above");
  assert.deepEqual(slip.kotRoundItems, [lineWithoutNumber]);
  assert.equal(slip.kotRoundItems?.length, 1);
  assert.equal(slip.kotRoundNumber, kotNumber);
  assert.equal(slip.kotRoundLabel, `Round ${payload.line.kotRound}`);
  assert.equal(slip.kotVariant, "void");
  assert.equal(slip.voidReason, payload.reason);
  assert.equal(slip.voidedBy, payload.voidedBy);
  assert.equal(slip.voidedAt, payload.voidedAt);
});

// ── 6. moved ─────────────────────────────────────────────────────────────

test('PIN: hostPrintSlipOf moved payload — kotVariant "moved"; movedFrom/movedBy/movedAt from payload.from/movedBy/movedAt (PH-4 MUST); kotRoundItems undefined (KOTReceipt\'s moved banner suppresses the item list itself)', () => {
  const payload: PrintJobPayload = {
    kind: "moved",
    snapshot: SNAPSHOT,
    from: "T-1",
    movedBy: "Staff",
    movedAt: "2026-09-06T11:30:00.000Z",
  };
  const slip = hostPrintSlipOf(payload, "2026-09-06");
  assert.equal(slip.surface, "kot");
  if (slip.surface !== "kot") throw new Error("unreachable");
  assert.equal(slip.kotVariant, "moved");
  assert.equal(slip.movedFrom, payload.from);
  assert.equal(slip.movedBy, payload.movedBy);
  assert.equal(slip.movedAt, payload.movedAt);
  assert.equal(slip.kotRoundItems, undefined);
});

// ── 7. cancel-notice ───────────────────────────────────────────────────────

test('PIN: hostPrintSlipOf cancel-notice payload — kotVariant "void"; voidReason = payload.reason; kotRoundItems undefined (whole-order void render lists every item, no round filter); voidedBy and voidedAt undefined (no single actor for a whole-order cancel)', () => {
  const payload: PrintJobPayload = {
    kind: "cancel-notice",
    snapshot: SNAPSHOT,
    reason: "Customer left",
  };
  const slip = hostPrintSlipOf(payload, "2026-09-06");
  assert.equal(slip.surface, "kot");
  if (slip.surface !== "kot") throw new Error("unreachable");
  assert.equal(slip.kotVariant, "void");
  assert.equal(slip.voidReason, payload.reason);
  assert.equal(slip.kotRoundItems, undefined);
  assert.equal(slip.voidedBy, undefined);
  assert.equal(slip.voidedAt, undefined);
});

// ── 8. bill ──────────────────────────────────────────────────────────────

test('PIN: hostPrintSlipOf bill payload — surface "receipt"; order._id equals snapshot._id; documentTitle = orderId', () => {
  const payload: PrintJobPayload = { kind: "bill", snapshot: SNAPSHOT };
  const slip = hostPrintSlipOf(payload, "2026-09-06");
  assert.equal(slip.surface, "receipt");
  if (slip.surface !== "receipt") throw new Error("unreachable");
  assert.equal(slip.order._id, SNAPSHOT._id);
  assert.equal(slip.documentTitle, SNAPSHOT.orderId);
});

// ── 9. eod ───────────────────────────────────────────────────────────────

test('PIN: hostPrintSlipOf eod payload — surface "eod"; isToday true when todayKey === dateKey and false otherwise; dateLabel passes through; documentTitle EOD-<dateKey>', () => {
  const payload: PrintJobPayload = { kind: "eod", dateKey: "2026-09-06", dateLabel: "Sun, 6 Sep 2026" };

  const todaySlip = hostPrintSlipOf(payload, "2026-09-06");
  assert.equal(todaySlip.surface, "eod");
  if (todaySlip.surface !== "eod") throw new Error("unreachable");
  assert.equal(todaySlip.isToday, true);
  assert.equal(todaySlip.dateLabel, payload.dateLabel);
  assert.equal(todaySlip.documentTitle, `EOD-${payload.dateKey}`);

  const pastSlip = hostPrintSlipOf(payload, "2026-09-07");
  assert.equal(pastSlip.surface, "eod");
  if (pastSlip.surface !== "eod") throw new Error("unreachable");
  assert.equal(pastSlip.isToday, false);
});

// ── 10. exhaustiveness over PRINT_JOB_KINDS ──────────────────────────────

function minimalPayloadOf(kind: PrintJobPayload["kind"]): PrintJobPayload {
  switch (kind) {
    case "kot":
      return { kind: "kot", snapshot: SNAPSHOT, round: 1 };
    case "bill":
      return { kind: "bill", snapshot: SNAPSHOT };
    case "void":
      return {
        kind: "void",
        snapshot: SNAPSHOT,
        line: {
          productId: "p1",
          name: "Filter Coffee",
          price: 4000,
          qty: 1,
          modifiers: [],
          instructions: "",
          kotRound: 1,
        },
        reason: "r",
        voidedBy: "Staff",
        voidedAt: "2026-09-06T00:00:00.000Z",
      };
    case "moved":
      return { kind: "moved", snapshot: SNAPSHOT, from: "T-1", movedBy: "Staff", movedAt: "2026-09-06T00:00:00.000Z" };
    case "eod":
      return { kind: "eod", dateKey: "2026-09-06", dateLabel: "Sun" };
    case "cancel-notice":
      return { kind: "cancel-notice", snapshot: SNAPSHOT, reason: "r" };
  }
}

test("UNIT: hostPrintSlipOf is exhaustive over PRINT_JOB_KINDS — every kind (minimal payload) resolves to a slip whose surface is one of kot|receipt|eod", () => {
  assert.ok(PRINT_JOB_KINDS.length > 0, "positive landmark: PRINT_JOB_KINDS must be non-empty");
  const seenSurfaces = new Set<string>();
  for (const kind of PRINT_JOB_KINDS) {
    const payload = minimalPayloadOf(kind);
    const slip = hostPrintSlipOf(payload, "2026-09-06");
    assert.ok(
      slip.surface === "kot" || slip.surface === "receipt" || slip.surface === "eod",
      `hostPrintSlipOf(${kind}) must resolve to a kot|receipt|eod surface, got ${slip.surface}`,
    );
    seenSurfaces.add(slip.surface);
  }
  // Positive landmark that this loop is not vacuous: at least the three known
  // surfaces were actually produced across the six kinds.
  assert.deepEqual([...seenSurfaces].sort(), ["eod", "kot", "receipt"]);
});

// ── 11. constants ─────────────────────────────────────────────────────────

test("PIN: PRINT_HOST_DRAIN_LOCK_NAME === \"pos.print-host.drain\"", () => {
  assert.equal(PRINT_HOST_DRAIN_LOCK_NAME, "pos.print-host.drain");
});

test("PIN: PRINT_HOST_EOD_READY_TIMEOUT_MS is a positive integer number of ms, less than 2 minutes", () => {
  assert.ok(Number.isInteger(PRINT_HOST_EOD_READY_TIMEOUT_MS), "must be an integer ms value");
  assert.ok(PRINT_HOST_EOD_READY_TIMEOUT_MS > 0, "must be positive");
  assert.ok(PRINT_HOST_EOD_READY_TIMEOUT_MS < 2 * 60 * 1000, "must be less than 2 minutes");
});

// PIN (2026-09-11): the dispatch watchdog must outlast BOTH the eod-readiness
// wait (so it never fires while that wait is still legitimately pending) and
// the desktop seam's own no-reply timeout (so a real desktop reply wins
// before the bridge gives the job up) — and it must still be bounded, not an
// effectively-infinite wedge.
test("PIN: PRINT_HOST_DISPATCH_TIMEOUT_MS is a positive integer, greater than PRINT_HOST_EOD_READY_TIMEOUT_MS, greater than the desktop seam's DESKTOP_PRINT_TIMEOUT_MS (35s), and less than 3 minutes", () => {
  assert.ok(Number.isInteger(PRINT_HOST_DISPATCH_TIMEOUT_MS), "must be an integer ms value");
  assert.ok(
    PRINT_HOST_DISPATCH_TIMEOUT_MS > PRINT_HOST_EOD_READY_TIMEOUT_MS,
    "must outlast the eod-readiness wait, or the watchdog could fire while that wait is still legitimately pending",
  );
  assert.ok(
    PRINT_HOST_DISPATCH_TIMEOUT_MS > DESKTOP_PRINT_TIMEOUT_MS,
    "must outlast the desktop seam's own 35s no-reply timeout, so a real desktop reply is never pre-empted by the bridge's own watchdog",
  );
  assert.ok(PRINT_HOST_DISPATCH_TIMEOUT_MS > 35_000, "must be greater than 35 seconds (the desktop seam's reply timeout)");
  assert.ok(PRINT_HOST_DISPATCH_TIMEOUT_MS < 3 * 60 * 1000, "must be less than 3 minutes — a bounded ceiling, not an effectively-infinite wait");
});

test('PIN: PRINT_HOST_EMPTY_SLIP_MESSAGE is a non-empty plain-English string ending with a period, and is distinct from PRINT_HOST_PRINT_FAILED_MESSAGE', () => {
  assert.ok(PRINT_HOST_EMPTY_SLIP_MESSAGE.length > 0, "must be non-empty");
  assert.ok(PRINT_HOST_EMPTY_SLIP_MESSAGE.trim().endsWith("."), "must end with a period, like every other operator-facing message here");
  assert.notEqual(
    PRINT_HOST_EMPTY_SLIP_MESSAGE,
    PRINT_HOST_PRINT_FAILED_MESSAGE,
    "the empty-slip message must be distinct from the generic print-failed message — the operator needs to know WHICH failure happened",
  );
});

// ── Parity pin — the void label prefix + variant, both sides ────────────
// lib/print-host-slips.ts's void branch and hooks/use-pos-print.ts's
// queueVoidSlip both build the label as `Round ${...kotRound}` and both set
// variant "void" — read BOTH raw sources (no stripComments — this is a
// source-text parity pin, same discipline as print-routing.test.ts) and
// assert the shared literals on each side, paired with a positive landmark
// so neither read can pass by reading an empty/blinded file.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PRINT_HOST_SLIPS_SRC = "apps/cafe/lib/print-host-slips.ts";
const USE_POS_PRINT_SRC = "apps/cafe/hooks/use-pos-print.ts";

test('PARITY: lib/print-host-slips.ts and hooks/use-pos-print.ts both build the void label as `Round ${...kotRound}` and both set variant "void" — a host-printed void slip and a locally-printed one must read identically', () => {
  const slipsSrc = readSrc(PRINT_HOST_SLIPS_SRC);
  const posPrintSrc = readSrc(USE_POS_PRINT_SRC);

  // positive landmarks first — proves neither read is vacuous/blinded.
  assert.match(slipsSrc, /kotRoundSlip\(/, "positive landmark: print-host-slips.ts must define kotRoundSlip(");
  assert.match(posPrintSrc, /setKotVariant\("void"\)/, 'positive landmark: use-pos-print.ts must call setKotVariant("void")');

  // both sides carry the literal "void" variant marker.
  assert.ok(slipsSrc.includes('"void"'), 'print-host-slips.ts must contain the literal "void" (kotVariant)');
  assert.ok(posPrintSrc.includes('"void"'), 'use-pos-print.ts must contain the literal "void" (setKotVariant)');

  // both sides build the SAME `Round ` label prefix — print-host-slips.ts
  // factors it into a named ROUND_LABEL_PREFIX = "Round " constant (used via
  // `${ROUND_LABEL_PREFIX}${round}`), while use-pos-print.ts inlines the
  // literal `Round ${round}` template directly; both constructions must
  // produce the identical "Round " text, so pin the literal string itself
  // rather than assume one shared template shape.
  assert.ok(slipsSrc.includes('"Round "'), 'print-host-slips.ts must build the label from the literal "Round " prefix');
  assert.match(posPrintSrc, /`Round \$\{/, "use-pos-print.ts must build the label via a literal `Round ${...}` template");
});
