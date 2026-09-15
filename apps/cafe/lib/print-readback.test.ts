import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  recordPrintReadback,
  prunePrintReadback,
  printReadbackRecordOf,
  printReadbackStateOf,
  printReadbackChips,
  printReadbackText,
  staleBandRows,
  printHostLabelOf,
  printHostWarnings,
  printBandVisible,
  printHostNoteOf,
  PRINT_READBACK_MAX_ENTRIES,
  PRINT_READBACK_UNSEEN_GRACE_MS,
  PRINT_READBACK_PRINTED_LINGER_MS,
  PRINT_READBACK_DISMISSED_LINGER_MS,
  PRINT_READBACK_UNKNOWN_LINGER_MS,
  type PrintReadbackEntry,
  type PrintReadbackRecord,
} from "./print-readback";
import {
  PRINT_HOST_OFFLINE_WARNING,
  PRINT_HOST_SILENT_OFF_WARNING,
  printHostActiveNote,
  printOrderSnapshot,
  type PrintHostState,
  type PrintJobFeedRow,
  type PrintJobResolvedRow,
} from "@pos/shared/print-job";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import type { Order, OrderItem } from "@/types";

// Print-host plan §B7 (PH-8) — DB-free unit tests over the PURE module
// lib/print-readback.ts: the readback record derivation (A-17), the bounded
// append/prune state machine (MERGED-10/19, the drain's attemptedRef
// discipline applied to readback), the per-order chip fold, the four exact
// readback strings, the stale-band row order (D-6), and the band's
// visible/warnings/note predicates. Zero React, zero DB, zero fetch — same
// idiom as lib/print-host-slips.test.ts's pure half. `orderFixture` mirrors
// lib/print-routing.test.ts's shape so printOrderSnapshot has a real Order to
// snapshot from.

// ── Fixtures ─────────────────────────────────────────────────────────────

const SNAPSHOT_ITEM: OrderItem = {
  productId: "p1",
  name: "Filter Coffee",
  price: 4000,
  qty: 2,
  variation: "Large",
  modifiers: ["Extra shot"],
  instructions: "No sugar",
  kotRound: 1,
};

function orderFixture(overrides: Partial<Order> = {}): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: [SNAPSHOT_ITEM],
    subtotal: 8000,
    discount: 0,
    total: 8000,
    paidAmount: 8000,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    tableNo: "T-4",
    kotRounds: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const BASE_PRINT_HOST_STATE: PrintHostState = {
  configured: true,
  deviceId: "dev-1",
  label: "Counter PC",
  lastSeenAt: "2026-01-01T00:00:00.000Z",
  offline: false,
  silentMode: false,
};

function printHostFixture(overrides: Partial<PrintHostState> = {}): PrintHostState {
  return { ...BASE_PRINT_HOST_STATE, ...overrides };
}

function pulseFixture(overrides: Partial<PosPulseData> = {}): PosPulseData {
  return {
    openCount: 0,
    openTruncated: false,
    newestOpenId: null,
    newestOpenAt: null,
    openRev: null,
    selfOrders: [],
    selfOrdersTruncated: false,
    printHost: printHostFixture(),
    printJobs: [],
    printJobsTruncated: false,
    stalePrintJobs: [],
    stalePrintJobsTruncated: false,
    resolvedPrintJobs: [],
    resolvedPrintJobsTruncated: false,
    ...overrides,
  };
}

function entryFixture(overrides: Partial<PrintReadbackEntry> = {}): PrintReadbackEntry {
  return {
    id: "job-1",
    kind: "kot",
    orderKey: "665f0a0000000000000000a1",
    orderRef: "T-4",
    recordedAt: 0,
    seen: false,
    absentSince: null,
    resolved: null,
    ...overrides,
  };
}

function feedRow(overrides: Partial<PrintJobFeedRow> = {}): PrintJobFeedRow {
  return { id: "job-1", kind: "kot", label: "KOT · T-4", createdAt: "2026-01-01T00:00:00.000Z", ...overrides };
}

function resolvedRow(overrides: Partial<PrintJobResolvedRow> = {}): PrintJobResolvedRow {
  return { id: "job-1", status: "printed", ...overrides };
}

// ── (a) printReadbackRecordOf ────────────────────────────────────────────

test('printReadbackRecordOf: kot payload with tableNo "4" -> orderKey = snapshot._id, orderRef "T-4"', () => {
  const order = orderFixture({ tableNo: "4" });
  const snapshot = printOrderSnapshot(order);
  const payload: PrintJobPayload = { kind: "kot", snapshot, round: 1 };
  const record = printReadbackRecordOf("job-1", payload);
  assert.equal(record.id, "job-1");
  assert.equal(record.kind, "kot");
  assert.equal(record.orderKey, snapshot._id);
  assert.equal(record.orderRef, "T-4");
});

test("printReadbackRecordOf: bill payload with tableNo undefined -> orderRef = snapshot.orderId", () => {
  const order = orderFixture({ tableNo: undefined });
  const snapshot = printOrderSnapshot(order);
  const payload: PrintJobPayload = { kind: "bill", snapshot };
  const record = printReadbackRecordOf("job-2", payload);
  assert.equal(record.orderRef, snapshot.orderId);
  assert.equal(record.orderKey, snapshot._id);
});

test('printReadbackRecordOf: bill payload with tableNo "" -> orderRef = snapshot.orderId', () => {
  const order = orderFixture({ tableNo: "" });
  const snapshot = printOrderSnapshot(order);
  const payload: PrintJobPayload = { kind: "bill", snapshot };
  const record = printReadbackRecordOf("job-3", payload);
  assert.equal(record.orderRef, snapshot.orderId);
});

test('printReadbackRecordOf: eod payload -> orderKey = the job id, orderRef contains the dateLabel', () => {
  const payload: PrintJobPayload = { kind: "eod", dateKey: "2026-01-05", dateLabel: "Mon, 5 Jan 2026" };
  const record = printReadbackRecordOf("job-eod-1", payload);
  assert.equal(record.orderKey, "job-eod-1");
  assert.ok(record.orderRef.includes("Mon, 5 Jan 2026"), `orderRef must contain the dateLabel, got "${record.orderRef}"`);
});

// ── (b) recordPrintReadback ──────────────────────────────────────────────

test("recordPrintReadback: appends with seen:false/absentSince:null/resolved:null/recordedAt=nowMs", () => {
  const record: PrintReadbackRecord = { id: "job-1", kind: "kot", orderKey: "o1", orderRef: "T-4" };
  const next = recordPrintReadback([], record, 1000);
  assert.equal(next.length, 1);
  assert.deepEqual(next[0], {
    id: "job-1", kind: "kot", orderKey: "o1", orderRef: "T-4",
    recordedAt: 1000, seen: false, absentSince: null, resolved: null,
  });
});

test("recordPrintReadback: returns the SAME array reference for an already-tracked id", () => {
  const entries = [entryFixture({ id: "job-1" })];
  const record: PrintReadbackRecord = { id: "job-1", kind: "bill", orderKey: "o1", orderRef: "T-4" };
  const next = recordPrintReadback(entries, record, 5000);
  assert.equal(next, entries, "an already-tracked id must return the SAME array reference");
});

test(`recordPrintReadback: caps at PRINT_READBACK_MAX_ENTRIES (${PRINT_READBACK_MAX_ENTRIES}) dropping the OLDEST when none is resolved`, () => {
  let entries: PrintReadbackEntry[] = [];
  for (let i = 0; i < PRINT_READBACK_MAX_ENTRIES; i++) {
    entries = recordPrintReadback(entries, { id: `job-${i}`, kind: "kot", orderKey: `o${i}`, orderRef: `T-${i}` }, i);
  }
  assert.equal(entries.length, PRINT_READBACK_MAX_ENTRIES);
  const overflowed = recordPrintReadback(entries, { id: "job-overflow", kind: "kot", orderKey: "oX", orderRef: "T-X" }, 999);
  assert.equal(overflowed.length, PRINT_READBACK_MAX_ENTRIES, "must stay capped at PRINT_READBACK_MAX_ENTRIES");
  assert.equal(overflowed[0].id, "job-1", "the OLDEST entry (job-0) must be dropped");
  assert.equal(overflowed[overflowed.length - 1].id, "job-overflow", "the newest entry must be appended at the end");
  assert.ok(!overflowed.some((e) => e.id === "job-0"), "job-0 (the oldest) must be gone");
});

test("recordPrintReadback: cap eviction prefers a RESOLVED entry over the oldest waiting one", () => {
  let entries: PrintReadbackEntry[] = [];
  for (let i = 0; i < PRINT_READBACK_MAX_ENTRIES; i++) {
    entries = recordPrintReadback(entries, { id: `job-${i}`, kind: "kot", orderKey: `o${i}`, orderRef: `T-${i}` }, i);
  }
  // Mark a MIDDLE entry (job-5) resolved — not the oldest (job-0) — so an
  // oldest-first eviction and a resolved-first eviction disagree.
  entries = entries.map((entry) =>
    entry.id === "job-5" ? { ...entry, resolved: { status: "printed", seenAt: 5 } } : entry,
  );
  const overflowed = recordPrintReadback(entries, { id: "job-overflow", kind: "kot", orderKey: "oX", orderRef: "T-X" }, 999);
  assert.equal(overflowed.length, PRINT_READBACK_MAX_ENTRIES, "must stay capped");
  assert.ok(!overflowed.some((e) => e.id === "job-5"), "the RESOLVED entry (job-5) must be evicted, not the oldest waiting one");
  assert.ok(overflowed.some((e) => e.id === "job-0"), "job-0 (the oldest, still waiting) must survive — a resolved entry is preferred for eviction");
});

// ── (c) prunePrintReadback ────────────────────────────────────────────────

test("prunePrintReadback: empty entries -> same ref", () => {
  const entries: PrintReadbackEntry[] = [];
  const next = prunePrintReadback(entries, pulseFixture(), 1000);
  assert.equal(next, entries);
});

test("prunePrintReadback: a degraded tick (printHost null) -> same ref even when the entry is in no feed", () => {
  const entries = [entryFixture({ id: "job-1" })];
  const next = prunePrintReadback(entries, pulseFixture({ printHost: null }), 1000);
  assert.equal(next, entries, "a degraded tick must never prune (MERGED-19)");
});

test('prunePrintReadback: id in printJobs (D1) -> seen:true, resolved null, state "waiting"', () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0 })];
  const pulse = pulseFixture({ printJobs: [feedRow({ id: "job-1" })] });
  const next = prunePrintReadback(entries, pulse, 1000);
  assert.equal(next.length, 1);
  assert.equal(next[0].seen, true);
  assert.equal(next[0].resolved, null);
  assert.equal(printReadbackStateOf(next[0]), "waiting");
});

test("prunePrintReadback: a second identical tick over an already-seen, still-queued row -> same ref (no churn)", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, absentSince: null })];
  const pulse = pulseFixture({ printJobs: [feedRow({ id: "job-1" })] });
  const next = prunePrintReadback(entries, pulse, 2000);
  assert.equal(next, entries, "an already-seen row still queued must not produce a new array");
});

test("prunePrintReadback: id in stalePrintJobs (D2) -> seen", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0 })];
  const pulse = pulseFixture({ stalePrintJobs: [feedRow({ id: "job-1" })] });
  const next = prunePrintReadback(entries, pulse, 1000);
  assert.equal(next[0].seen, true);
  assert.equal(next[0].resolved, null);
});

test('prunePrintReadback: id in resolvedPrintJobs status printed -> resolved.status printed, seenAt=nowMs, state "printed"', () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0 })];
  const pulse = pulseFixture({ resolvedPrintJobs: [resolvedRow({ id: "job-1", status: "printed" })] });
  const next = prunePrintReadback(entries, pulse, 5000);
  assert.equal(next.length, 1);
  assert.equal(next[0].resolved?.status, "printed");
  assert.equal(next[0].resolved?.seenAt, 5000);
  assert.equal(printReadbackStateOf(next[0]), "printed");
});

test('prunePrintReadback: dismissed with dismissReason "staff" -> state "cancelled-at-host"', () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0 })];
  const pulse = pulseFixture({ resolvedPrintJobs: [resolvedRow({ id: "job-1", status: "dismissed", dismissReason: "staff" })] });
  const next = prunePrintReadback(entries, pulse, 5000);
  assert.equal(printReadbackStateOf(next[0]), "cancelled-at-host");
});

test('prunePrintReadback: dismissed with "order-cancelled" -> state "cancelled"', () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0 })];
  const pulse = pulseFixture({ resolvedPrintJobs: [resolvedRow({ id: "job-1", status: "dismissed", dismissReason: "order-cancelled" })] });
  const next = prunePrintReadback(entries, pulse, 5000);
  assert.equal(printReadbackStateOf(next[0]), "cancelled");
});

test('prunePrintReadback: dismissed with NO dismissReason -> state "cancelled"', () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0 })];
  const pulse = pulseFixture({ resolvedPrintJobs: [resolvedRow({ id: "job-1", status: "dismissed", dismissReason: undefined })] });
  const next = prunePrintReadback(entries, pulse, 5000);
  assert.equal(printReadbackStateOf(next[0]), "cancelled");
});

test("prunePrintReadback: STICKY — an entry already resolved stays resolved even when a later tick shows it in no feed", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, resolved: { status: "printed", seenAt: 1000 } })];
  const pulse = pulseFixture(); // no feed carries job-1 at all
  const next = prunePrintReadback(entries, pulse, 1500);
  assert.equal(next.length, 1);
  assert.equal(next[0].resolved?.status, "printed", "a resolved entry must not flip back to unresolved by absence");
  assert.equal(next[0].resolved?.seenAt, 1000, "seenAt (the linger base) must not be touched by a later tick");
});

test(`prunePrintReadback: linger — a printed entry is dropped once nowMs - seenAt > PRINT_READBACK_PRINTED_LINGER_MS (${PRINT_READBACK_PRINTED_LINGER_MS}), and kept at exactly the boundary`, () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, resolved: { status: "printed", seenAt: 1000 } })];
  const atBoundary = prunePrintReadback(entries, pulseFixture(), 1000 + PRINT_READBACK_PRINTED_LINGER_MS);
  assert.equal(atBoundary.length, 1, "exactly at the linger boundary the entry must still be kept");
  const pastBoundary = prunePrintReadback(entries, pulseFixture(), 1000 + PRINT_READBACK_PRINTED_LINGER_MS + 1);
  assert.equal(pastBoundary.length, 0, "past the linger boundary the entry must be dropped");
});

test(`prunePrintReadback: linger — a dismissed entry uses PRINT_READBACK_DISMISSED_LINGER_MS (${PRINT_READBACK_DISMISSED_LINGER_MS}), longer than the printed linger`, () => {
  assert.ok(PRINT_READBACK_DISMISSED_LINGER_MS > PRINT_READBACK_PRINTED_LINGER_MS, "positive landmark: the dismissed linger must be longer than the printed linger");
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, resolved: { status: "dismissed", dismissReason: "staff", seenAt: 1000 } })];
  const stillWithinDismissedLinger = prunePrintReadback(entries, pulseFixture(), 1000 + PRINT_READBACK_DISMISSED_LINGER_MS);
  assert.equal(stillWithinDismissedLinger.length, 1, "at exactly the dismissed linger boundary the entry must still be kept");
  const pastDismissedLinger = prunePrintReadback(entries, pulseFixture(), 1000 + PRINT_READBACK_DISMISSED_LINGER_MS + 1);
  assert.equal(pastDismissedLinger.length, 0, "past the dismissed linger the entry must be dropped");
});

test(`prunePrintReadback: unseen + absent within PRINT_READBACK_UNSEEN_GRACE_MS (${PRINT_READBACK_UNSEEN_GRACE_MS}) -> kept; past the grace -> dropped`, () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: false })];
  const withinGrace = prunePrintReadback(entries, pulseFixture(), PRINT_READBACK_UNSEEN_GRACE_MS);
  assert.equal(withinGrace.length, 1, "at exactly the grace boundary an unseen entry must still be kept");
  const pastGrace = prunePrintReadback(entries, pulseFixture(), PRINT_READBACK_UNSEEN_GRACE_MS + 1);
  assert.equal(pastGrace.length, 0, "past the grace an unseen+absent entry must be dropped");
});

test("prunePrintReadback: seen then absent (feed NOT truncated) -> dropped (never a ✓ by absence)", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true })];
  const next = prunePrintReadback(entries, pulseFixture(), 500); // well within the unseen grace, but this entry is SEEN
  assert.equal(next.length, 0, "a seen entry absent from every feed, with no feed truncated, must be dropped immediately, not granted the unseen grace");
});

test("prunePrintReadback: an entry queued in the stale band (D2) for 31+ minutes is KEPT waiting — no readback-local age drop (§B7: D2 is still \"Waiting\")", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true })];
  const pulse = pulseFixture({ stalePrintJobs: [feedRow({ id: "job-1" })] });
  const next = prunePrintReadback(entries, pulse, 31 * 60 * 1000); // 31 minutes later, still in D2
  assert.equal(next.length, 1, "a job still queued (even in the stale band past 30 min) must stay in the readback");
  assert.equal(printReadbackStateOf(next[0]), "waiting");
});

test("prunePrintReadback: seen + absent + a feed TRUNCATED -> kept as waiting, absentSince stamped on first absence (same object identity on the next tick), dropped after the unknown linger", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, absentSince: null })];
  const truncatedPulse = pulseFixture({ resolvedPrintJobsTruncated: true }); // job-1 in no feed, but D3 was cut
  const firstAbsentTick = prunePrintReadback(entries, truncatedPulse, 1000);
  assert.equal(firstAbsentTick.length, 1, "a seen+absent entry under a truncated feed must be kept, not dropped");
  assert.equal(firstAbsentTick[0].absentSince, 1000, "absentSince must be stamped to nowMs on the first tick it goes missing");
  assert.equal(printReadbackStateOf(firstAbsentTick[0]), "waiting");

  const secondAbsentTick = prunePrintReadback(firstAbsentTick, truncatedPulse, 2000);
  assert.equal(secondAbsentTick[0], firstAbsentTick[0], "a second tick still absent+truncated must not re-stamp absentSince — same object identity");

  const withinLinger = prunePrintReadback(firstAbsentTick, truncatedPulse, 1000 + PRINT_READBACK_UNKNOWN_LINGER_MS);
  assert.equal(withinLinger.length, 1, "at exactly the unknown-linger boundary the entry must still be kept");
  const pastLinger = prunePrintReadback(firstAbsentTick, truncatedPulse, 1000 + PRINT_READBACK_UNKNOWN_LINGER_MS + 1);
  assert.equal(pastLinger.length, 0, "past the unknown linger the entry must be dropped");
});

test("prunePrintReadback: seen + absent + NO feed truncated -> dropped (a truncation-only reprieve, not a general one)", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, absentSince: null })];
  const pulse = pulseFixture({ printJobsTruncated: false, stalePrintJobsTruncated: false, resolvedPrintJobsTruncated: false });
  const next = prunePrintReadback(entries, pulse, 1000);
  assert.equal(next.length, 0, "a seen+absent entry must be dropped when no feed was truncated");
});

test("prunePrintReadback: reappearing in a feed resets absentSince to null", () => {
  const entries = [entryFixture({ id: "job-1", recordedAt: 0, seen: true, absentSince: 1000 })];
  const pulse = pulseFixture({ printJobs: [feedRow({ id: "job-1" })] });
  const next = prunePrintReadback(entries, pulse, 2000);
  assert.equal(next[0].absentSince, null, "reappearing in D1/D2 must reset absentSince to null");
});

test("prunePrintReadback: a changed result is a NEW array, and entries not touched keep their own identity", () => {
  const untouched = entryFixture({ id: "job-untouched", recordedAt: 0, seen: true }); // stays seen, still queued -> no change
  const changing = entryFixture({ id: "job-changing", recordedAt: 0, seen: false }); // will become seen
  const entries = [untouched, changing];
  const pulse = pulseFixture({ printJobs: [feedRow({ id: "job-untouched" }), feedRow({ id: "job-changing" })] });
  const next = prunePrintReadback(entries, pulse, 1000);
  assert.notEqual(next, entries, "a changed result must be a NEW array");
  assert.equal(next[0], untouched, "an entry not touched by this tick must keep its own object identity");
  assert.notEqual(next[1], changing, "the entry that changed must be a new object");
});

// ── (d) printReadbackChips ────────────────────────────────────────────────

test('printReadbackChips: two entries same orderKey (kot printed + bill waiting) -> ONE chip, kinds "KOT, Bill", state "waiting" (waiting outranks printed)', () => {
  const entries: PrintReadbackEntry[] = [
    entryFixture({ id: "job-kot", kind: "kot", orderKey: "o1", orderRef: "T-4", resolved: { status: "printed", seenAt: 100 } }),
    entryFixture({ id: "job-bill", kind: "bill", orderKey: "o1", orderRef: "T-4", resolved: null }),
  ];
  const chips = printReadbackChips(entries);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kinds, "KOT, Bill");
  assert.equal(chips[0].state, "waiting");
});

test('printReadbackChips: cancelled-at-host outranks cancelled outranks waiting', () => {
  const entries: PrintReadbackEntry[] = [
    entryFixture({ id: "job-1", kind: "kot", orderKey: "o1", resolved: null }),
    entryFixture({ id: "job-2", kind: "bill", orderKey: "o1", resolved: { status: "dismissed", dismissReason: "order-cancelled", seenAt: 100 } }),
    entryFixture({ id: "job-3", kind: "void", orderKey: "o1", resolved: { status: "dismissed", dismissReason: "staff", seenAt: 100 } }),
  ];
  const chips = printReadbackChips(entries);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].state, "cancelled-at-host");
});

test("printReadbackChips: two orders -> two chips in insertion order", () => {
  const entries: PrintReadbackEntry[] = [
    entryFixture({ id: "job-1", orderKey: "o1", orderRef: "T-1" }),
    entryFixture({ id: "job-2", orderKey: "o2", orderRef: "T-2" }),
  ];
  const chips = printReadbackChips(entries);
  assert.equal(chips.length, 2);
  assert.equal(chips[0].key, "o1");
  assert.equal(chips[1].key, "o2");
});

test("printReadbackChips: duplicate kind not repeated", () => {
  const entries: PrintReadbackEntry[] = [
    entryFixture({ id: "job-1", kind: "kot", orderKey: "o1" }),
    entryFixture({ id: "job-2", kind: "kot", orderKey: "o1" }),
  ];
  const chips = printReadbackChips(entries);
  assert.equal(chips.length, 1);
  assert.equal(chips[0].kinds, "KOT");
});

// ── (e) printReadbackText ─────────────────────────────────────────────────

test("printReadbackText: the four exact strings", () => {
  assert.equal(printReadbackText("waiting", "the print host"), "Waiting for the print host");
  assert.equal(printReadbackText("printed", "the print host"), "Sent to the print host ✓");
  assert.equal(printReadbackText("cancelled", "the print host"), "Cancelled — nothing printed");
  assert.equal(printReadbackText("cancelled-at-host", "the print host"), "Cancelled at host");
});

// ── (f) staleBandRows ─────────────────────────────────────────────────────

test("staleBandRows: rows given OLDEST-first are returned NEWEST-first", () => {
  const rows: PrintJobFeedRow[] = [
    feedRow({ id: "old", label: "Old", createdAt: "2026-01-01T00:00:00.000Z" }),
    feedRow({ id: "mid", label: "Mid", createdAt: "2026-01-01T01:00:00.000Z" }),
    feedRow({ id: "new", label: "New", createdAt: "2026-01-01T02:00:00.000Z" }),
  ];
  const { shown } = staleBandRows(rows, Date.parse("2026-01-01T03:00:00.000Z"));
  assert.deepEqual(shown.map((r) => r.id), ["new", "mid", "old"]);
});

test("staleBandRows: capped at PRINT_BAND_MAX_STALE_BUTTONS, hiddenCount = total - shown", () => {
  const nowIso = "2026-01-01T10:00:00.000Z";
  const rows: PrintJobFeedRow[] = Array.from({ length: 5 }, (_, i) =>
    feedRow({ id: `row-${i}`, label: `Row ${i}`, createdAt: `2026-01-01T0${i}:00:00.000Z` }),
  );
  const { shown, hiddenCount } = staleBandRows(rows, Date.parse(nowIso));
  assert.ok(shown.length <= 3, "must cap at PRINT_BAND_MAX_STALE_BUTTONS (3)");
  assert.equal(hiddenCount, rows.length - shown.length);
});

test("staleBandRows: ageMinutes floors correctly and never negative", () => {
  const rows: PrintJobFeedRow[] = [feedRow({ id: "r1", createdAt: "2026-01-01T00:00:00.000Z" })];
  const { shown } = staleBandRows(rows, Date.parse("2026-01-01T00:02:59.000Z")); // 2m59s later
  assert.equal(shown[0].ageMinutes, 2, "2m59s must floor to 2 minutes");

  const futureRows: PrintJobFeedRow[] = [feedRow({ id: "r2", createdAt: "2026-01-01T00:05:00.000Z" })];
  const { shown: futureShown } = staleBandRows(futureRows, Date.parse("2026-01-01T00:00:00.000Z")); // createdAt AFTER now
  assert.equal(futureShown[0].ageMinutes, 0, "a negative age must clamp to 0, never negative");
});

test("staleBandRows: a malformed createdAt row is excluded and counted in hiddenCount", () => {
  const rows: PrintJobFeedRow[] = [
    feedRow({ id: "good", createdAt: "2026-01-01T00:00:00.000Z" }),
    feedRow({ id: "bad", createdAt: "not-a-date" }),
  ];
  const { shown, hiddenCount } = staleBandRows(rows, Date.parse("2026-01-01T01:00:00.000Z"));
  assert.deepEqual(shown.map((r) => r.id), ["good"], "the malformed row must be excluded from `shown`");
  assert.equal(hiddenCount, 1, "the malformed row must be counted in hiddenCount, not silently lost");
});

// ── (g) printHostWarnings ──────────────────────────────────────────────────

test("printHostWarnings: null -> []", () => {
  assert.deepEqual(printHostWarnings(null), []);
});

test("printHostWarnings: configured false -> []", () => {
  assert.deepEqual(printHostWarnings(printHostFixture({ configured: false, offline: true, silentMode: false })), []);
});

test("printHostWarnings: configured+offline+silentMode false -> [OFFLINE, SILENT_OFF] in that order", () => {
  const warnings = printHostWarnings(printHostFixture({ configured: true, offline: true, silentMode: false }));
  assert.deepEqual(warnings, [PRINT_HOST_OFFLINE_WARNING, PRINT_HOST_SILENT_OFF_WARNING]);
});

test("printHostWarnings: configured online silent -> []", () => {
  assert.deepEqual(printHostWarnings(printHostFixture({ configured: true, offline: false, silentMode: true })), []);
});

// ── (h) printBandVisible ───────────────────────────────────────────────────

test("printBandVisible: readback non-empty -> true even with pulse undefined", () => {
  assert.equal(printBandVisible(undefined, [entryFixture()]), true);
});

test("printBandVisible: pulse undefined + empty readback -> false", () => {
  assert.equal(printBandVisible(undefined, []), false);
});

test("printBandVisible: warning-only -> true", () => {
  const pulse = pulseFixture({ printHost: printHostFixture({ configured: true, offline: true }) });
  assert.equal(printBandVisible(pulse, []), true);
});

test("printBandVisible: stale-only -> true", () => {
  const pulse = pulseFixture({ stalePrintJobs: [feedRow()] });
  assert.equal(printBandVisible(pulse, []), true);
});

test("printBandVisible: quiet configured host -> false", () => {
  const pulse = pulseFixture({ printHost: printHostFixture({ configured: true, offline: false, silentMode: true }), stalePrintJobs: [] });
  assert.equal(printBandVisible(pulse, []), false);
});

test("printBandVisible: unconfigured (dark) host -> false", () => {
  const pulse = pulseFixture({ printHost: printHostFixture({ configured: false }), stalePrintJobs: [] });
  assert.equal(printBandVisible(pulse, []), false);
});

// ── (i) printHostNoteOf ────────────────────────────────────────────────────

test("printHostNoteOf: undefined pulse -> null regardless of printHostSeen", () => {
  assert.equal(printHostNoteOf(undefined, false), null);
  assert.equal(printHostNoteOf(undefined, true), null);
});

test("printHostNoteOf: unconfigured -> null", () => {
  const pulse = pulseFixture({ printHost: printHostFixture({ configured: false }) });
  assert.equal(printHostNoteOf(pulse, false), null);
});

test('printHostNoteOf: configured with label "Counter PC" -> printHostActiveNote("Counter PC") and contains no literal "<label>"', () => {
  const pulse = pulseFixture({ printHost: printHostFixture({ configured: true, label: "Counter PC" }) });
  const note = printHostNoteOf(pulse, false);
  assert.equal(note, printHostActiveNote("Counter PC"));
  assert.ok(note !== null && !note.includes("<label>"), 'the note must never contain the literal placeholder "<label>"');
});

test("printHostNoteOf: configured with label null -> uses the fallback label", () => {
  const pulse = pulseFixture({ printHost: printHostFixture({ configured: true, label: null }) });
  const note = printHostNoteOf(pulse, false);
  assert.equal(note, printHostActiveNote(printHostLabelOf(printHostFixture({ configured: true, label: null }))));
});

test("printHostNoteOf: a degraded tick (printHost null) + printHostSeen true -> the fallback-label active note (MERGED-19: a device that has SEEN a host is not told it has none)", () => {
  const pulse = pulseFixture({ printHost: null });
  const note = printHostNoteOf(pulse, true);
  assert.equal(note, printHostActiveNote(printHostLabelOf(null)));
});

test("printHostNoteOf: a degraded tick (printHost null) + printHostSeen false -> null", () => {
  const pulse = pulseFixture({ printHost: null });
  assert.equal(printHostNoteOf(pulse, false), null);
});

// ── (j) printHostLabelOf fallback ──────────────────────────────────────────

test("printHostLabelOf: null host -> fallback label", () => {
  const fallback = printHostLabelOf(null);
  assert.ok(fallback.length > 0);
  assert.equal(printHostLabelOf(printHostFixture({ configured: false, label: "Counter PC" })), fallback, "an unconfigured host must fall back too, even with a stored label");
  assert.equal(printHostLabelOf(printHostFixture({ configured: true, label: null })), fallback, "a configured host with a null label must fall back");
});

test("printHostLabelOf: configured host with a label -> that label, verbatim", () => {
  assert.equal(printHostLabelOf(printHostFixture({ configured: true, label: "Counter PC" })), "Counter PC");
});

// ── (k) PH-10 Slice C1 — imported-not-duplicated source pin ────────────────
// Mirrors self-order-alert-paths.test.ts:280-283's technique (own-string-
// literal readback + assert the CONSUMER never hardcodes the same wording):
// lib/print-readback.ts must consume PRINT_HOST_OFFLINE_WARNING,
// PRINT_HOST_SILENT_OFF_WARNING and the FUNCTION printHostActiveNote from
// @pos/shared/print-job — never re-typing any of the three wordings as its
// own literal. The constant PRINT_HOST_ACTIVE_NOTE itself is NOT imported
// here (only its wrapper function is) — this must stay a function call, not
// a literal `.replace("<label>", …)` reimplementation.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const PRINT_READBACK_LIB = "apps/cafe/lib/print-readback.ts";
const PRINT_JOB_SHARED = "packages/shared/src/print-job.ts";

test("PIN (C1): print-readback.ts imports PRINT_HOST_OFFLINE_WARNING, PRINT_HOST_SILENT_OFF_WARNING and the printHostActiveNote FUNCTION from @pos/shared/print-job, and never duplicates their wording as its own string literal", () => {
  const readbackSrc = stripComments(readSrc(PRINT_READBACK_LIB));

  // Positive landmarks first (the import + both call sites actually exist).
  assert.match(
    readbackSrc,
    /import\s*\{[^}]*\bPRINT_HOST_OFFLINE_WARNING\b[^}]*\}\s*from\s*"@pos\/shared\/print-job"/,
    "print-readback.ts must import PRINT_HOST_OFFLINE_WARNING from @pos/shared/print-job",
  );
  assert.match(
    readbackSrc,
    /import\s*\{[^}]*\bPRINT_HOST_SILENT_OFF_WARNING\b[^}]*\}\s*from\s*"@pos\/shared\/print-job"/,
    "print-readback.ts must import PRINT_HOST_SILENT_OFF_WARNING from @pos/shared/print-job",
  );
  assert.match(
    readbackSrc,
    /import\s*\{[^}]*\bprintHostActiveNote\b[^}]*\}\s*from\s*"@pos\/shared\/print-job"/,
    "print-readback.ts must import the printHostActiveNote FUNCTION from @pos/shared/print-job",
  );
  assert.match(
    readbackSrc,
    /warnings\.push\(PRINT_HOST_OFFLINE_WARNING\)/,
    "positive landmark: print-readback.ts must actually push PRINT_HOST_OFFLINE_WARNING somewhere",
  );
  assert.match(
    readbackSrc,
    /host\.configured \? printHostActiveNote\(/,
    "positive landmark: print-readback.ts must call printHostActiveNote( in the host.configured branch",
  );

  // The constant PRINT_HOST_ACTIVE_NOTE (as opposed to the function) is NOT
  // imported here — only its wrapper function is threaded through.
  assert.ok(
    !/import\s*\{[^}]*\bPRINT_HOST_ACTIVE_NOTE\b[^}]*\}\s*from\s*"@pos\/shared\/print-job"/.test(readbackSrc),
    "print-readback.ts must NOT import the PRINT_HOST_ACTIVE_NOTE constant directly — only printHostActiveNote(), the function",
  );

  // Negative pins: none of the three shared wordings may be duplicated here
  // as the module's OWN string literal — a future edit to the shared
  // constant would otherwise silently stop reaching this module.
  const sharedSrc = readSrc(PRINT_JOB_SHARED);
  const activeNoteMatch = sharedSrc.match(/PRINT_HOST_ACTIVE_NOTE =\s*\n?\s*"([^"]+)"/);
  const offlineMatch = sharedSrc.match(/PRINT_HOST_OFFLINE_WARNING =\s*\n?\s*"([^"]+)"/);
  const silentOffMatch = sharedSrc.match(/PRINT_HOST_SILENT_OFF_WARNING =\s*\n?\s*"([^"]+)"/);
  assert.ok(activeNoteMatch, "could not read PRINT_HOST_ACTIVE_NOTE's own string literal from packages/shared/src/print-job.ts");
  assert.ok(offlineMatch, "could not read PRINT_HOST_OFFLINE_WARNING's own string literal from packages/shared/src/print-job.ts");
  assert.ok(silentOffMatch, "could not read PRINT_HOST_SILENT_OFF_WARNING's own string literal from packages/shared/src/print-job.ts");

  assert.ok(
    !readbackSrc.includes(activeNoteMatch![1]),
    "print-readback.ts must not carry PRINT_HOST_ACTIVE_NOTE's wording as its own hardcoded string — only via printHostActiveNote()",
  );
  assert.ok(
    !readbackSrc.includes(offlineMatch![1]),
    "print-readback.ts must not carry PRINT_HOST_OFFLINE_WARNING's wording as its own hardcoded string — only via the imported constant",
  );
  assert.ok(
    !readbackSrc.includes(silentOffMatch![1]),
    "print-readback.ts must not carry PRINT_HOST_SILENT_OFF_WARNING's wording as its own hardcoded string — only via the imported constant",
  );
});
