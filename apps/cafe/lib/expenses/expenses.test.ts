import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import {
  EXPENSE_FUTURE_DATE_ERROR,
  EXPENSE_OLD_DATE_ERROR,
  expenseDateError,
  expenseDateWindow,
  listQueryFilter,
  toExpenseDto,
  type ExpenseRow,
} from "./entries";
import { EXPENSE_BACKDATE_MAX_DAYS } from "@pos/shared/expense";

// Step EXP — DB-free pins over the pure helpers of lib/expenses (entries.ts; report.ts is in expenses-report.test.ts,
// the file-size split). Oracles are hand-written literals, not recomputed through the code
// under test. The clock is fixed just after an IST midnight: 18:45Z on Oct 10 is
// already Oct 11 in IST (+05:30), so a UTC-date bug cannot pass.

const NOW = new Date("2026-10-10T18:45:00Z");
const IST_TODAY = "2026-10-11";
// IST day of NOW: 2026-10-11 00:00+05:30 .. 23:59:59.999+05:30
const DAY_START = new Date("2026-10-10T18:30:00.000Z");
const DAY_END = new Date("2026-10-11T18:29:59.999Z");

const CAT_ID = "665f0000000000000000c001";
const STAFF_ID = "665f0000000000000000a001";
const RANGE = { from: "2026-10-01", to: "2026-10-09" };

// ── listQueryFilter ─────────────────────────────────────────────────────────

test("listQueryFilter: staff is FORCED to mine-today even when range/category/mode are passed", () => {
  const { scope, filter } = listQueryFilter({
    isAdmin: false,
    userId: STAFF_ID,
    now: NOW,
    range: RANGE,
    categoryId: CAT_ID,
    mode: "upi",
  });
  assert.equal(scope, "mine-today");
  assert.deepEqual(filter.deletedAt, { $exists: false });
  assert.equal(filter.createdById, STAFF_ID);
  assert.deepEqual(filter.createdAt, { $gte: DAY_START, $lte: DAY_END });
  // The ignored inputs leave no trace in the filter.
  assert.equal("date" in filter, false);
  assert.equal("categoryId" in filter, false);
  assert.equal("paymentMode" in filter, false);
});

test("listQueryFilter: staff window is the IST day (not the UTC day) at the midnight boundary", () => {
  const { filter } = listQueryFilter({ isAdmin: false, userId: STAFF_ID, now: NOW });
  // 18:45Z Oct 10 is the FIRST minutes of IST Oct 11 — the window starts at 18:30Z Oct 10.
  assert.equal(filter.createdAt?.$gte.toISOString(), "2026-10-10T18:30:00.000Z");
  assert.equal(filter.createdAt?.$lte.toISOString(), "2026-10-11T18:29:59.999Z");
});

test("listQueryFilter: an admin WITHOUT a range also falls to mine-today (never an unbounded list)", () => {
  const { scope, filter } = listQueryFilter({ isAdmin: true, userId: STAFF_ID, now: NOW });
  assert.equal(scope, "mine-today");
  assert.equal(filter.createdById, STAFF_ID);
});

test("listQueryFilter: admin range filter with categoryId cast to ObjectId and payment mode", () => {
  const { scope, filter } = listQueryFilter({
    isAdmin: true,
    userId: "admin-1",
    now: NOW,
    range: RANGE,
    categoryId: CAT_ID,
    mode: "card",
  });
  assert.equal(scope, "range");
  assert.deepEqual(filter.date, { $gte: "2026-10-01", $lte: "2026-10-09" });
  assert.ok(filter.categoryId instanceof Types.ObjectId, "categoryId is an ObjectId (raw $match does not cast)");
  assert.equal(filter.categoryId.toHexString(), CAT_ID);
  assert.equal(filter.paymentMode, "card");
  assert.equal("createdById" in filter, false);
  assert.equal("createdAt" in filter, false);
});

test("listQueryFilter: admin range without category/mode carries only date + the active filter", () => {
  const { filter } = listQueryFilter({ isAdmin: true, userId: "admin-1", now: NOW, range: RANGE });
  assert.deepEqual(Object.keys(filter).sort(), ["date", "deletedAt"]);
});

test("listQueryFilter: deletedAt {$exists:false} is present on BOTH scopes", () => {
  const staff = listQueryFilter({ isAdmin: false, userId: STAFF_ID, now: NOW }).filter;
  const admin = listQueryFilter({ isAdmin: true, userId: "a", now: NOW, range: RANGE }).filter;
  assert.deepEqual(staff.deletedAt, { $exists: false });
  assert.deepEqual(admin.deletedAt, { $exists: false });
});

// ── date window / error ─────────────────────────────────────────────────────

test("expenseDateWindow: max is the IST day, min is exactly 366 days before it (hand-computed)", () => {
  assert.equal(EXPENSE_BACKDATE_MAX_DAYS, 366);
  const { min, max } = expenseDateWindow(NOW);
  assert.equal(max, IST_TODAY);
  // 2026-10-11 minus 365 days = 2025-10-11 (no Feb 29 in between), minus 366 = 2025-10-10.
  assert.equal(min, "2025-10-10");
});

test("expenseDateError: today (IST) ok, the UTC date ok, tomorrow is the future error", () => {
  assert.equal(expenseDateError("2026-10-11", NOW), null);
  assert.equal(expenseDateError("2026-10-10", NOW), null);
  assert.equal(expenseDateError("2026-10-12", NOW), EXPENSE_FUTURE_DATE_ERROR);
});

test("expenseDateError: exactly 366 days back ok, 367 days back is the old error", () => {
  assert.equal(expenseDateError("2025-10-10", NOW), null);
  assert.equal(expenseDateError("2025-10-09", NOW), EXPENSE_OLD_DATE_ERROR);
});

test("expenseDateError: the two messages are distinct, plain-English copy", () => {
  assert.equal(EXPENSE_FUTURE_DATE_ERROR, "The date can't be in the future");
  assert.equal(EXPENSE_OLD_DATE_ERROR, "The date can't be more than a year ago");
});

// ── toExpenseDto ────────────────────────────────────────────────────────────

function lean(extra: Record<string, unknown> = {}): ExpenseRow {
  return {
    _id: new Types.ObjectId("665f0000000000000000e001"),
    name: "Milk",
    categoryId: new Types.ObjectId(CAT_ID),
    date: "2026-10-09",
    amountPaise: 45050,
    paymentMode: "cash",
    createdBy: "Asha",
    createdAt: new Date("2026-10-09T05:00:00Z"),
    updatedAt: new Date("2026-10-09T06:00:00Z"),
    // internals that must never leave the server
    ...({ clientRef: "ref", createdById: STAFF_ID, v: 1, deletedAt: new Date(), deletedBy: "x" } as object),
    ...extra,
  } as ExpenseRow;
}

test("toExpenseDto: exact wire shape, ids as strings, ISO dates, paise stay an integer", () => {
  const dto = toExpenseDto(lean());
  assert.deepEqual(dto, {
    id: "665f0000000000000000e001",
    name: "Milk",
    categoryId: CAT_ID,
    date: "2026-10-09",
    amountPaise: 45050,
    paymentMode: "cash",
    createdBy: "Asha",
    createdAt: "2026-10-09T05:00:00.000Z",
    updatedAt: "2026-10-09T06:00:00.000Z",
    edited: false,
  });
  assert.ok(Number.isInteger(dto.amountPaise));
});

test("toExpenseDto: clientRef / createdById / v / deletedAt / deletedBy / edits never leak", () => {
  const keys = Object.keys(toExpenseDto(lean({ edits: [{ amountPaise: 1 }] })));
  for (const banned of ["clientRef", "createdById", "v", "deletedAt", "deletedBy", "edits"]) {
    assert.equal(keys.includes(banned), false, `${banned} must not be on the wire`);
  }
  // positive landmark: the keys that SHOULD be there are
  assert.ok(keys.includes("amountPaise") && keys.includes("edited") && keys.includes("updatedAt"));
});

test("toExpenseDto: edited flag follows edits.length (absent, empty, non-empty)", () => {
  assert.equal(toExpenseDto(lean()).edited, false);
  assert.equal(toExpenseDto(lean({ edits: [] })).edited, false);
  assert.equal(toExpenseDto(lean({ edits: [{}] })).edited, true);
  assert.equal(toExpenseDto(lean({ edits: [{}, {}] })).edited, true);
});

test("toExpenseDto: note omitted when absent, carried when present", () => {
  assert.equal("note" in toExpenseDto(lean()), false);
  assert.equal(toExpenseDto(lean({ note: "two cartons" })).note, "two cartons");
});

