import { test } from "node:test";
import assert from "node:assert/strict";
import {
  printHostOffline,
  printJobDrainCandidate,
  printJobPayloadWithinCap,
  printOrderSnapshot,
  PRINT_HOST_OFFLINE_MS,
  PRINT_JOB_DISMISS_REASONS,
  PRINT_JOB_PAYLOAD_MAX_BYTES,
  type PrintJobFeedRow,
} from "./print-job";
import { printJobPayloadSchema, printOrderSnapshotSchema } from "./schemas/print-job.schema";
import type { Order } from "./types";

// Helper: a minimally-valid feed row, overridable per-test.
function feedRow(overrides: Partial<PrintJobFeedRow> = {}): PrintJobFeedRow {
  return {
    id: "j1",
    kind: "kot",
    label: "KOT round 1 · T-4",
    orderId: "o1",
    createdAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

// Helper: a minimally-valid full Order, overridable per-test.
function order(overrides: Partial<Order> = {}): Order {
  return {
    _id: "o1",
    orderId: "ORD-20260822-001",
    customerName: "Walk-In",
    items: [
      {
        productId: "p1",
        name: "Cold Coffee",
        price: 120,
        qty: 2,
        variation: "Large",
        modifiers: ["Extra shot"],
        instructions: "Less sugar",
        kotRound: 1,
      },
    ],
    subtotal: 240,
    discount: 0,
    total: 240,
    paidAmount: 240,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff A",
    kotRounds: 1,
    createdAt: "2026-08-22T10:00:00.000Z",
    updatedAt: "2026-08-22T10:00:00.000Z",
    ...overrides,
  };
}

// -- dismiss-reason contract --------------------------------------------------

test("PRINT_JOB_DISMISS_REASONS pins five §B1 values (four §B1 + the PH-3 claim-path `invalid-payload`) verbatim — server writers stamp them, the band branches on \"staff\"", () => {
  assert.deepEqual(
    [...PRINT_JOB_DISMISS_REASONS],
    ["order-cancelled", "round-voided", "staff", "host-cleared", "invalid-payload"],
  );
});

// -- printHostOffline -------------------------------------------------------

test("printHostOffline: null lastSeenAt is offline", () => {
  assert.equal(printHostOffline(null, Date.now()), true);
});

test("printHostOffline: fresh lastSeenAt is NOT offline", () => {
  const now = Date.parse("2026-08-22T10:00:30.000Z");
  assert.equal(printHostOffline("2026-08-22T10:00:00.000Z", now), false);
});

test("printHostOffline: exactly-at-boundary is still NOT offline (only strictly-over is)", () => {
  const lastSeenAt = "2026-08-22T10:00:00.000Z";
  const now = Date.parse(lastSeenAt) + PRINT_HOST_OFFLINE_MS;
  assert.equal(printHostOffline(lastSeenAt, now), false);
});

test("printHostOffline: past-boundary is offline", () => {
  const lastSeenAt = "2026-08-22T10:00:00.000Z";
  const now = Date.parse(lastSeenAt) + PRINT_HOST_OFFLINE_MS + 1;
  assert.equal(printHostOffline(lastSeenAt, now), true);
});

test("printHostOffline: malformed ISO is offline, never throws", () => {
  assert.doesNotThrow(() => printHostOffline("not-a-date", Date.now()));
  assert.equal(printHostOffline("not-a-date", Date.now()), true);
});

// -- printJobDrainCandidate ---------------------------------------------------

test("printJobDrainCandidate: oldest-first ordering (kitchen order)", () => {
  const now = Date.parse("2026-08-22T10:09:00.000Z");
  const rows = [
    feedRow({ id: "newer", createdAt: "2026-08-22T10:05:00.000Z" }),
    feedRow({ id: "oldest", createdAt: "2026-08-22T10:01:00.000Z" }),
  ];
  const candidate = printJobDrainCandidate(rows, now, 30 * 60 * 1000);
  assert.equal(candidate?.id, "oldest");
});

test("printJobDrainCandidate: exactly-30-min-old row is still eligible (D1/D2 boundary)", () => {
  const createdAt = "2026-08-22T10:00:00.000Z";
  const maxAgeMs = 30 * 60 * 1000;
  const now = Date.parse(createdAt) + maxAgeMs;
  const rows = [feedRow({ id: "boundary", createdAt })];
  const candidate = printJobDrainCandidate(rows, now, maxAgeMs);
  assert.equal(candidate?.id, "boundary");
});

test("printJobDrainCandidate: over-30-min row is skipped (falls to the stale band, D2)", () => {
  const createdAt = "2026-08-22T10:00:00.000Z";
  const maxAgeMs = 30 * 60 * 1000;
  const now = Date.parse(createdAt) + maxAgeMs + 1;
  const rows = [feedRow({ id: "stale", createdAt })];
  assert.equal(printJobDrainCandidate(rows, now, maxAgeMs), null);
});

test("printJobDrainCandidate: malformed createdAt is skipped, not thrown on", () => {
  const now = Date.parse("2026-08-22T10:05:00.000Z");
  const rows = [
    feedRow({ id: "bad", createdAt: "not-a-real-date" }),
    feedRow({ id: "good", createdAt: "2026-08-22T10:01:00.000Z" }),
  ];
  assert.doesNotThrow(() => printJobDrainCandidate(rows, now, 30 * 60 * 1000));
  assert.equal(printJobDrainCandidate(rows, now, 30 * 60 * 1000)?.id, "good");
});

test("printJobDrainCandidate: empty list returns null", () => {
  assert.equal(printJobDrainCandidate([], Date.now(), 30 * 60 * 1000), null);
});

// -- printJobPayloadWithinCap -------------------------------------------------

test("printJobPayloadWithinCap: exactly at the byte cap passes", () => {
  const json = JSON.stringify({ pad: "a".repeat(PRINT_JOB_PAYLOAD_MAX_BYTES - '{"pad":""}'.length) });
  assert.equal(new TextEncoder().encode(json).length, PRINT_JOB_PAYLOAD_MAX_BYTES);
  assert.equal(printJobPayloadWithinCap(json), true);
});

test("printJobPayloadWithinCap: one byte over fails", () => {
  const json = JSON.stringify({ pad: "a".repeat(PRINT_JOB_PAYLOAD_MAX_BYTES - '{"pad":""}'.length + 1) });
  assert.equal(new TextEncoder().encode(json).length, PRINT_JOB_PAYLOAD_MAX_BYTES + 1);
  assert.equal(printJobPayloadWithinCap(json), false);
});

test("printJobPayloadWithinCap: a multibyte character near the cap counts by BYTES, not chars", () => {
  // "€" is 1 UTF-16 char but 3 UTF-8 bytes — a char-length check would
  // under-count this string's real wire cost by 2 bytes per euro sign.
  const charBudget = PRINT_JOB_PAYLOAD_MAX_BYTES - 2; // char count that FITS if measured wrongly
  const json = "€".repeat(charBudget);
  assert.equal(json.length, charBudget);
  assert.ok(new TextEncoder().encode(json).length > PRINT_JOB_PAYLOAD_MAX_BYTES);
  assert.equal(printJobPayloadWithinCap(json), false);
});

// -- printJobPayloadSchema ----------------------------------------------------

test("printJobPayloadSchema: valid kot member (numeric round) parses", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printJobPayloadSchema.safeParse({ kind: "kot", snapshot, round: 2 });
  assert.equal(parsed.success, true);
});

test("printJobPayloadSchema: kot round accepts null (whole-tab reprint)", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printJobPayloadSchema.safeParse({ kind: "kot", snapshot, round: null });
  assert.equal(parsed.success, true);
});

test("printJobPayloadSchema: kot round rejects undefined (must be stated, not omitted)", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printJobPayloadSchema.safeParse({ kind: "kot", snapshot });
  assert.equal(parsed.success, false);
});

test("printJobPayloadSchema: wrong kind-shape is rejected (bill payload tagged as void)", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printJobPayloadSchema.safeParse({ kind: "void", snapshot });
  assert.equal(parsed.success, false);
});

test("printJobPayloadSchema: eod rejects an extra snapshot field (no snapshot allowed)", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printJobPayloadSchema.safeParse({
    kind: "eod",
    dateKey: "2026-08-22",
    dateLabel: "22 Aug 2026",
    snapshot,
  });
  assert.equal(parsed.success, false);
});

test("printJobPayloadSchema: eod without a snapshot parses", () => {
  const parsed = printJobPayloadSchema.safeParse({
    kind: "eod",
    dateKey: "2026-08-22",
    dateLabel: "22 Aug 2026",
  });
  assert.equal(parsed.success, true);
});

test("printJobPayloadSchema: cancel-notice requires reason", () => {
  const snapshot = printOrderSnapshot(order());
  const missing = printJobPayloadSchema.safeParse({ kind: "cancel-notice", snapshot });
  assert.equal(missing.success, false);
  const withReason = printJobPayloadSchema.safeParse({
    kind: "cancel-notice",
    snapshot,
    reason: "Customer left",
  });
  assert.equal(withReason.success, true);
});

test("printJobPayloadSchema: valid moved member parses", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printJobPayloadSchema.safeParse({
    kind: "moved",
    snapshot,
    from: "T-3",
    movedBy: "Staff A",
    movedAt: "2026-08-22T10:05:00.000Z",
  });
  assert.equal(parsed.success, true);
});

// Helper: a fully-valid void payload — the synthesized line PLUS the void
// entry's own reason/actor/moment (the slip prints those, never the tab's
// opener/open time — CR1.3).
function voidPayload() {
  return {
    kind: "void",
    snapshot: printOrderSnapshot(order()),
    line: {
      productId: "p1",
      name: "Cold Coffee",
      variation: "Large",
      price: 120,
      qty: 1,
      modifiers: ["Extra shot"],
      instructions: "Less sugar",
      kotRound: 1,
      kotNumber: 4,
    },
    reason: "guest changed mind",
    voidedBy: "Staff B",
    voidedAt: "2026-08-22T10:20:00.000Z",
  };
}

test("printJobPayloadSchema: valid void member parses with the synthesized line + void meta", () => {
  assert.equal(printJobPayloadSchema.safeParse(voidPayload()).success, true);
});

test("printJobPayloadSchema: void REQUIRES reason/voidedBy/voidedAt — a slip without them names the wrong staff and time", () => {
  for (const key of ["reason", "voidedBy", "voidedAt"] as const) {
    const { [key]: _dropped, ...rest } = voidPayload();
    assert.equal(printJobPayloadSchema.safeParse(rest).success, false, `void must reject a missing ${key}`);
  }
});

// -- printOrderSnapshotSchema landmark keys ----------------------------------

test("printOrderSnapshotSchema: parses a full valid snapshot built by printOrderSnapshot", () => {
  const snapshot = printOrderSnapshot(order());
  const parsed = printOrderSnapshotSchema.safeParse(snapshot);
  assert.equal(parsed.success, true);
});

test("printOrderSnapshotSchema: exposes gstMode and status at order level (positive landmark)", () => {
  const shape = printOrderSnapshotSchema.shape;
  assert.ok("gstMode" in shape, "schema must expose gstMode — the suite must not go vacuous");
  assert.ok("status" in shape, "schema must expose status — the suite must not go vacuous");
});

test("printOrderSnapshotSchema: carries the KOT's default-on kitchen note through printOrderSnapshot", () => {
  assert.ok("notes" in printOrderSnapshotSchema.shape, "schema must expose notes (KOTReceipt prints it by default)");
  const snapshot = printOrderSnapshot(order({ notes: "no peanuts — allergy" }));
  assert.equal(snapshot.notes, "no peanuts — allergy");
  assert.equal(printOrderSnapshotSchema.safeParse(snapshot).success, true);
});

test("printOrderSnapshotSchema: rejects unknown keys — a whole live Order can't ride in as a snapshot", () => {
  const smuggled = { ...printOrderSnapshot(order()), voids: [] };
  assert.equal(printOrderSnapshotSchema.safeParse(smuggled).success, false);
});

test("printOrderSnapshotSchema: item sub-schema exposes modifiers/instructions/variation/name", () => {
  const itemShape = printOrderSnapshotSchema.shape.items.element.shape;
  assert.ok("modifiers" in itemShape, "item schema must expose modifiers");
  assert.ok("instructions" in itemShape, "item schema must expose instructions");
  assert.ok("variation" in itemShape, "item schema must expose variation");
  assert.ok("name" in itemShape, "item schema must expose name");
});
