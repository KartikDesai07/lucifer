import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AMOUNT_FORMAT_ERROR,
  AMOUNT_TOO_BIG_ERROR,
  AMOUNT_ZERO_ERROR,
  CATEGORY_ERROR,
  DATE_ERROR,
  NAME_ERROR,
  buildCreateInput,
  buildUpdateInput,
  offeredCategoryId,
  validateExpenseForm,
  type ExpenseFormValues,
} from "./expense-form";
import { expensesCsvRows } from "@/lib/expenses/csv";
import { createExpenseSchema, updateExpenseSchema } from "@/schemas";
import type { ExpenseDto } from "@/types/expenses";

// Step EXP — the add/edit sheet's pure rules (components/expenses/expense-form.ts)
// and the CSV rows (lib/expenses/csv.ts), DB-free. The clock is a fixed "today";
// the oldest allowed day is 366 days back = 2025-10-09 (hand-computed: 2026-10-10
// minus 365 = 2025-10-10, minus one more = 2025-10-09).

const TODAY = "2026-10-10";
const OLDEST = "2025-10-09";
const TOO_OLD = "2025-10-08";
const CAT = "665f0000000000000000c001";
const OTHER_CAT = "665f0000000000000000c002";
const UUID = "3f2b8c1e-9d4a-4c7e-8b1a-2f6d5e4c3b2a";

const form = (over: Partial<ExpenseFormValues> = {}): ExpenseFormValues => ({
  amountText: "450.50",
  name: "Milk",
  categoryId: CAT,
  date: TODAY,
  paymentMode: "cash",
  note: "",
  ...over,
});

const dto = (over: Partial<ExpenseDto> = {}): ExpenseDto => ({
  id: "665f0000000000000000e001",
  name: "Milk",
  categoryId: CAT,
  date: TODAY,
  amountPaise: 45050,
  paymentMode: "cash",
  createdBy: "Asha",
  createdAt: "2026-10-10T05:00:00.000Z",
  updatedAt: "2026-10-10T06:00:00.000Z",
  edited: false,
  ...over,
});

// ── validateExpenseForm ─────────────────────────────────────────────────────

test("validateExpenseForm: a valid add has no errors and carries the integer paise (string math)", () => {
  const check = validateExpenseForm(form(), TODAY);
  assert.deepEqual(check.errors, {});
  assert.equal(check.amountPaise, 45050);
  assert.equal(validateExpenseForm(form({ amountText: "1,200" }), TODAY).amountPaise, 120000);
});

test("validateExpenseForm: amount errors (blank, junk, 3 decimals, zero, over the cap) each name the right copy", () => {
  for (const bad of ["", "abc", "450.505", "-5"]) {
    const check = validateExpenseForm(form({ amountText: bad }), TODAY);
    assert.equal(check.errors.amount, AMOUNT_FORMAT_ERROR, `"${bad}"`);
    assert.equal(check.amountPaise, null);
  }
  assert.equal(validateExpenseForm(form({ amountText: "0" }), TODAY).errors.amount, AMOUNT_ZERO_ERROR);
  assert.equal(validateExpenseForm(form({ amountText: "0.00" }), TODAY).errors.amount, AMOUNT_ZERO_ERROR);
  assert.equal(validateExpenseForm(form({ amountText: "1000001" }), TODAY).errors.amount, AMOUNT_TOO_BIG_ERROR);
  // the cap itself is fine: Rs 10,00,000 = 100000000 paise
  const atCap = validateExpenseForm(form({ amountText: "1000000" }), TODAY);
  assert.equal(atCap.errors.amount, undefined);
  assert.equal(atCap.amountPaise, 100000000);
});

test("validateExpenseForm: blank / whitespace name and no category are refused", () => {
  const check = validateExpenseForm(form({ name: "   ", categoryId: "" }), TODAY);
  assert.equal(check.errors.name, NAME_ERROR);
  assert.equal(check.errors.categoryId, CATEGORY_ERROR);
  assert.equal(validateExpenseForm(form(), TODAY).errors.name, undefined); // landmark: a good form has neither
});

test("validateExpenseForm: an ADD (no originalDate) always checks the window, edges inclusive", () => {
  assert.equal(validateExpenseForm(form({ date: OLDEST }), TODAY).errors.date, undefined);
  assert.equal(validateExpenseForm(form({ date: TODAY }), TODAY).errors.date, undefined);
  assert.equal(validateExpenseForm(form({ date: TOO_OLD }), TODAY).errors.date, DATE_ERROR);
  assert.equal(validateExpenseForm(form({ date: "2026-10-11" }), TODAY).errors.date, DATE_ERROR);
});

test('validateExpenseForm: "" is always a date error, add or edit', () => {
  assert.equal(validateExpenseForm(form({ date: "" }), TODAY).errors.date, DATE_ERROR);
  assert.equal(validateExpenseForm(form({ date: "" }), TODAY, TODAY).errors.date, DATE_ERROR);
  assert.equal(validateExpenseForm(form({ date: "" }), TODAY, "").errors.date, DATE_ERROR);
});

test("validateExpenseForm: an edit keeps an UNCHANGED date that aged past the window, but holds a CHANGED date to it", () => {
  const aged = "2024-01-01";
  // unchanged old date passes (the row can still be corrected)
  assert.equal(validateExpenseForm(form({ date: aged }), TODAY, aged).errors.date, undefined);
  // changed to another out-of-window date fails (old and future)
  assert.equal(validateExpenseForm(form({ date: TOO_OLD }), TODAY, aged).errors.date, DATE_ERROR);
  assert.equal(validateExpenseForm(form({ date: "2026-10-11" }), TODAY, aged).errors.date, DATE_ERROR);
  // changed into the window passes
  assert.equal(validateExpenseForm(form({ date: OLDEST }), TODAY, aged).errors.date, undefined);
  // the same old date WITHOUT originalDate (an add) fails, so the exemption is the edit's alone
  assert.equal(validateExpenseForm(form({ date: aged }), TODAY).errors.date, DATE_ERROR);
});

// ── buildCreateInput ────────────────────────────────────────────────────────

test("buildCreateInput: trims name and note, passes integer paise and the clientRef through", () => {
  const input = buildCreateInput(form({ name: "  Milk  ", note: "  two cartons ", paymentMode: "upi" }), 45050, UUID);
  assert.deepEqual(input, {
    name: "Milk",
    categoryId: CAT,
    date: TODAY,
    amountPaise: 45050,
    paymentMode: "upi",
    note: "two cartons",
    clientRef: UUID,
  });
  assert.ok(Number.isInteger(input.amountPaise));
  assert.equal(createExpenseSchema.safeParse(input).success, true, "the built request passes the real create schema");
});

test("buildCreateInput: a blank or whitespace note is omitted (no note key, not an empty string)", () => {
  for (const note of ["", "   "]) {
    const input = buildCreateInput(form({ note }), 45050, UUID);
    assert.equal("note" in input, false);
  }
  assert.equal(buildCreateInput(form({ note: "x" }), 1, UUID).note, "x"); // landmark: a real note IS kept
});

// ── buildUpdateInput ────────────────────────────────────────────────────────

test("buildUpdateInput: nothing changed -> null (padding-only differences do not count)", () => {
  assert.equal(buildUpdateInput(dto(), form(), 45050), null);
  assert.equal(buildUpdateInput(dto(), form({ name: " Milk ", note: "  " }), 45050), null);
  assert.equal(buildUpdateInput(dto({ note: "x" }), form({ note: "x " }), 45050), null);
});

test("buildUpdateInput: only the changed fields go, plus expectedUpdatedAt = before.updatedAt", () => {
  const before = dto();
  assert.deepEqual(buildUpdateInput(before, form(), 50000), { amountPaise: 50000, expectedUpdatedAt: before.updatedAt });
  assert.deepEqual(buildUpdateInput(before, form({ paymentMode: "card" }), 45050), {
    paymentMode: "card",
    expectedUpdatedAt: before.updatedAt,
  });
  const many = buildUpdateInput(
    before,
    form({ name: "Milk x2", categoryId: OTHER_CAT, date: "2026-10-09", paymentMode: "bank", note: "n" }),
    60000,
  );
  assert.deepEqual(many, {
    name: "Milk x2",
    categoryId: OTHER_CAT,
    date: "2026-10-09",
    amountPaise: 60000,
    paymentMode: "bank",
    note: "n",
    expectedUpdatedAt: before.updatedAt,
  });
  assert.equal(updateExpenseSchema.safeParse(many).success, true, "the built request passes the real update schema");
});

test("buildUpdateInput: a cleared note goes as the empty string; a new note on a note-less row goes as text", () => {
  const cleared = buildUpdateInput(dto({ note: "two cartons" }), form({ note: "" }), 45050);
  assert.deepEqual(cleared, { note: "", expectedUpdatedAt: "2026-10-10T06:00:00.000Z" });
  assert.equal(updateExpenseSchema.safeParse(cleared).success, true);
  assert.equal(buildUpdateInput(dto(), form({ note: " later " }), 45050)?.note, "later");
});

test("buildUpdateInput: an unchanged (possibly hidden) categoryId is never re-sent; a changed one is", () => {
  const same = buildUpdateInput(dto(), form({ categoryId: CAT }), 50000);
  assert.ok(same, "landmark: a patch was built");
  assert.equal("categoryId" in same, false);
  const moved = buildUpdateInput(dto(), form({ categoryId: OTHER_CAT }), 45050);
  assert.equal(moved?.categoryId, OTHER_CAT);
  // an unchanged old date is not re-sent either (the server would only re-validate a changed one)
  const aged = buildUpdateInput(dto({ date: "2024-01-01" }), form({ date: "2024-01-01" }), 50000);
  assert.equal(aged && "date" in aged, false);
});

// ── expensesCsvRows ─────────────────────────────────────────────────────────

const NAMES = new Map([[CAT, "Ingredients"]]);

test("expensesCsvRows: header keys are exactly the planned seven, in order, ASCII only", () => {
  const [row] = expensesCsvRows([dto({ note: "n" })], NAMES);
  const keys = Object.keys(row);
  assert.deepEqual(keys, ["Date", "What", "Category", "Paid by", "Amount (INR)", "Note", "Added by"]);
  for (const key of keys) assert.match(key, /^[\x20-\x7e]+$/, `"${key}" is plain ASCII`);
});

test("expensesCsvRows: paise become a 2-dp rupee figure by integer math (45050 -> 450.50)", () => {
  const amount = (paise: number) => expensesCsvRows([dto({ amountPaise: paise })], NAMES)[0]["Amount (INR)"];
  assert.equal(amount(45050), "450.50");
  assert.equal(amount(45000), "450.00");
  assert.equal(amount(5), "0.05");
  assert.equal(amount(100), "1.00");
  assert.equal(amount(100000000), "1000000.00");
});

test("expensesCsvRows: a row maps the date, label, category name, note and who added it", () => {
  const [row] = expensesCsvRows([dto({ paymentMode: "bank", note: "two cartons" })], NAMES);
  assert.deepEqual(row, {
    Date: TODAY,
    What: "Milk",
    Category: "Ingredients",
    "Paid by": "Bank transfer",
    "Amount (INR)": "450.50",
    Note: "two cartons",
    "Added by": "Asha",
  });
  // absent note and an unknown category become blank cells, in the given order
  const rows = expensesCsvRows([dto({ id: "x", categoryId: OTHER_CAT }), dto({ name: "Second" })], NAMES);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].Note, "");
  assert.equal(rows[0].Category, "");
  assert.equal(rows[1].What, "Second");
});

test("expensesCsvRows: a formula-leading typed cell is neutralised with a leading apostrophe; plain text is untouched", () => {
  for (const lead of ["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "\rx"]) {
    const [row] = expensesCsvRows([dto({ name: lead, note: lead, createdBy: lead })], new Map([[CAT, lead]]));
    for (const cell of [row.What, row.Note, row["Added by"], row.Category]) {
      assert.equal(cell, "'" + lead, `${JSON.stringify(lead)} is neutralised`);
    }
  }
  const [plain] = expensesCsvRows([dto({ name: "Milk = good", note: "a-b" })], NAMES);
  assert.equal(plain.What, "Milk = good"); // landmark: only a LEADING character triggers it
  assert.equal(plain.Note, "a-b");
});

test("offeredCategoryId: an offered id is kept; a hidden/removed one becomes empty; an unloaded list keeps it", () => {
  const options = [{ value: "a" }, { value: "b" }];
  assert.equal(offeredCategoryId(options, "a"), "a");
  assert.equal(offeredCategoryId(options, "gone"), "", "no longer offered -> the placeholder + Pick a category");
  assert.equal(offeredCategoryId(options, ""), "");
  assert.equal(offeredCategoryId([], "a"), "", "a loaded but empty list offers nothing");
  assert.equal(offeredCategoryId(null, "a"), "a", "not loaded yet -> keep the id, the server decides");
});
