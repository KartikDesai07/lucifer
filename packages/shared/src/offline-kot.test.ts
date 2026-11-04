import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OFFLINE_LABEL,
  OFFLINE_LINES_MAX,
  OFFLINE_TAKEN_MAX_AGE_MS,
  OFFLINE_TAKEN_MAX_AHEAD_MS,
  keptTakenAt,
  offlineBannerOf,
  offlineRefOf,
  offlineRoundSchema,
} from "./offline-kot";
import { addItemsSchema, createOrderSchema } from "./schemas/order.schema";

// Printing Phase 5 (spec 2026-11-03 §5.9): the `offline` field an order request carries when its round was
// taken while the device could not reach the server. Its KOT already printed on the device ("OFFLINE · O-3").

const NOW = Date.UTC(2026, 10, 4, 8, 0, 0);
const round = (over: Record<string, unknown> = {}) => ({
  ref: "O-3",
  takenAt: NOW - 60_000,
  lines: [{ printerId: "p1", part: "s1", outcome: "printed" }],
  ...over,
});

test("offlineRefOf counts from O-1 to O-9999", () => {
  assert.equal(offlineRefOf(1), "O-1", "the first offline number");
  assert.equal(offlineRefOf(9999), "O-9999", "the last offline number");
  for (const bad of [0, 10000, 1.5, Number.NaN]) {
    assert.throws(() => offlineRefOf(bad), RangeError, `offlineRefOf(${bad}) must throw a RangeError`);
  }
});

test("offlineBannerOf joins the word and the number", () => {
  assert.equal(OFFLINE_LABEL, "OFFLINE", "the label word");
  assert.equal(offlineBannerOf("O-3"), "OFFLINE · O-3", "the banner text (P5-5)");
});

test("the round schema takes printed, maybe and later lines", () => {
  const r = offlineRoundSchema.safeParse(
    round({
      total: 240,
      lines: [
        { printerId: null, part: "-", outcome: "printed" },
        { printerId: "p1", part: "s1", outcome: "maybe" },
        { printerId: "p2", part: "all", outcome: "later" },
      ],
    }),
  );
  assert.equal(r.success, true, `a valid round must parse: ${r.success ? "" : r.error.message}`);
  assert.equal(r.success && r.data.lines.length, 3, "every line is kept");
  assert.equal(r.success && r.data.total, 240, "the sale's total is kept");
});

test("the round schema refuses what it does not know", () => {
  const refused: Array<[string, unknown]> = [
    ["ref O-0", round({ ref: "O-0" })],
    ["ref O-10000", round({ ref: "O-10000" })],
    ["ref X-3", round({ ref: "X-3" })],
    ["ref O-03", round({ ref: "O-03" })],
    ["an unknown key on the round", round({ extra: 1 })],
    ["an unknown key on a line", round({ lines: [{ printerId: "p1", part: "s1", outcome: "printed", x: 1 }] })],
    ["outcome no", round({ lines: [{ printerId: "p1", part: "s1", outcome: "no" }] })],
    ["an empty part", round({ lines: [{ printerId: "p1", part: "", outcome: "printed" }] })],
    ["an empty printer id", round({ lines: [{ printerId: "", part: "s1", outcome: "printed" }] })],
    ["a missing printer id", round({ lines: [{ part: "s1", outcome: "printed" }] })],
    [
      `${OFFLINE_LINES_MAX + 1} lines`,
      round({ lines: Array.from({ length: OFFLINE_LINES_MAX + 1 }, () => ({ printerId: "p1", part: "s1", outcome: "later" })) }),
    ],
    ["a missing takenAt", round({ takenAt: undefined })],
    ["a non-integer takenAt", round({ takenAt: 1.5 })],
    ["a zero takenAt", round({ takenAt: 0 })],
    ["a negative total", round({ total: -1 })],
  ];
  for (const [what, value] of refused) {
    assert.equal(offlineRoundSchema.safeParse(value).success, false, `the round schema must refuse ${what}`);
  }
  const max = round({ lines: Array.from({ length: OFFLINE_LINES_MAX }, () => ({ printerId: "p1", part: "s1", outcome: "later" })) });
  assert.equal(offlineRoundSchema.safeParse(max).success, true, `${OFFLINE_LINES_MAX} lines are allowed`);
});

test("keptTakenAt keeps a time inside the last 12 hours and up to 5 minutes ahead", () => {
  assert.equal(OFFLINE_TAKEN_MAX_AGE_MS, 12 * 60 * 60 * 1000, "12 hours back");
  assert.equal(OFFLINE_TAKEN_MAX_AHEAD_MS, 5 * 60 * 1000, "5 minutes ahead");
  assert.equal(keptTakenAt(NOW - OFFLINE_TAKEN_MAX_AGE_MS, NOW), NOW - OFFLINE_TAKEN_MAX_AGE_MS, "exactly 12 h back is kept");
  assert.equal(keptTakenAt(NOW - OFFLINE_TAKEN_MAX_AGE_MS - 1, NOW), null, "past 12 h is not kept");
  assert.equal(keptTakenAt(NOW + OFFLINE_TAKEN_MAX_AHEAD_MS, NOW), NOW + OFFLINE_TAKEN_MAX_AHEAD_MS, "5 min ahead is kept");
  assert.equal(keptTakenAt(NOW + OFFLINE_TAKEN_MAX_AHEAD_MS + 1, NOW), null, "past 5 min ahead is not kept");
  assert.equal(keptTakenAt(NOW, NOW), NOW, "now is kept");
});

// The two order schemas (kept here: order.schema.test.ts is already past the 300-line rule).
const items = [{ productId: "64b7f0c2a1d2e3f4a5b6c7d8", name: "Chai", price: 20, qty: 1 }];
const sale = { customerName: "Walk-in", items, subtotal: 20, total: 20, payment: "Cash", receiver: "cashier" };

test("createOrderSchema and addItemsSchema accept an optional offline round", () => {
  const withCreate = createOrderSchema.safeParse({ ...sale, offline: round() });
  assert.equal(withCreate.success, true, "a create with the field parses");
  assert.deepEqual(withCreate.success && withCreate.data.offline, round(), "the create keeps the field (not stripped)");
  const without = createOrderSchema.safeParse(sale);
  assert.equal(without.success && without.data.offline, undefined, "a create without the field has none");
  const withRound = addItemsSchema.safeParse({ items, offline: round() });
  assert.equal(withRound.success, true, "a round with the field parses");
  assert.deepEqual(withRound.success && withRound.data.offline, round(), "the round keeps the field");
  assert.equal(addItemsSchema.safeParse({ items }).success, true, "a round without the field parses");
  assert.equal(createOrderSchema.safeParse({ ...sale, offline: round({ ref: "O-0" }) }).success, false, "a bad field is refused on the create");
});

test("addItemsSchema still refuses unknown keys", () => {
  assert.equal(addItemsSchema.safeParse({ items, offlin: round() }).success, false, "a misspelt key is refused (.strict())");
});
