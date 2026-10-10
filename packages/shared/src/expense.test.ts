import { test } from "node:test";
import assert from "node:assert/strict";

import {
  EXPENSE_AMOUNT_MAX_PAISE,
  EXPENSE_DEFAULT_CATEGORIES,
  EXPENSE_PAYMENT_MODES,
  EXPENSE_PAYMENT_MODE_LABELS,
  expensePaidFrom,
  paiseToRupeesText,
  rupeesTextToPaise,
} from "./expense";
import {
  createExpenseCategorySchema,
  createExpenseSchema,
  expenseListQuerySchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
} from "./schemas/expense.schema";

const INT32_MAX = 2_147_483_647;
const ID = "665f0000000000000000a001";
const UUID = "3b241101-e2bb-4255-8caf-4136c566a962";

const validCreate = {
  name: "Milk 10 L",
  categoryId: ID,
  date: "2026-10-10",
  amountPaise: 45000,
  paymentMode: "cash",
  clientRef: UUID,
};

test("rupeesTextToPaise: exact string math for every accepted shape", () => {
  const cases: Array<[string, number | null]> = [
    ["450", 45000],
    ["450.5", 45050],
    ["450.50", 45050],
    ["0.05", 5],
    ["19.99", 1999], // the float trap: 19.99 * 100 = 1998.999…
    ["1,200", 120000],
    [" 1 200.25 ", 120025],
    ["0", 0],
    ["", null],
    [".5", null],
    ["450.", null],
    ["450.505", null],
    ["-5", null],
    ["1e3", null],
    ["₹450", null],
    ["abc", null],
  ];
  for (const [text, expected] of cases) assert.equal(rupeesTextToPaise(text), expected, `input ${JSON.stringify(text)}`);
});

test("paiseToRupeesText round-trips through rupeesTextToPaise", () => {
  assert.equal(paiseToRupeesText(45000), "450");
  assert.equal(paiseToRupeesText(45050), "450.50");
  assert.equal(paiseToRupeesText(5), "0.05");
  for (const paise of [1, 5, 99, 100, 1999, 45050, EXPENSE_AMOUNT_MAX_PAISE]) {
    assert.equal(rupeesTextToPaise(paiseToRupeesText(paise)), paise);
  }
});

test("the amount cap fits a BSON Int32", () => {
  assert.ok(EXPENSE_AMOUNT_MAX_PAISE < INT32_MAX);
});

test("payment modes: labels for every mode, and P12's cash|bank split", () => {
  assert.deepEqual([...EXPENSE_PAYMENT_MODES], ["cash", "upi", "card", "bank"]);
  for (const mode of EXPENSE_PAYMENT_MODES) assert.ok(EXPENSE_PAYMENT_MODE_LABELS[mode].length > 0);
  assert.equal(expensePaidFrom("cash"), "cash");
  for (const mode of ["upi", "card", "bank"] as const) assert.equal(expensePaidFrom(mode), "bank");
});

test("the owner's 8 default categories (popup 2026-10-10)", () => {
  assert.deepEqual(
    [...EXPENSE_DEFAULT_CATEGORIES],
    ["Ingredients", "Gas", "Salaries", "Rent", "Utilities", "Maintenance", "Packaging", "Other"],
  );
});

test("createExpenseSchema: accepts a valid body and trims text", () => {
  const parsed = createExpenseSchema.parse({ ...validCreate, name: "  Milk 10 L ", note: " paid at gate " });
  assert.equal(parsed.name, "Milk 10 L");
  assert.equal(parsed.note, "paid at gate");
});

test("createExpenseSchema: refuses bad money, dates, modes, refs and unknown keys", () => {
  const bad: Array<Record<string, unknown>> = [
    { amountPaise: 0 },
    { amountPaise: -100 },
    { amountPaise: 450.5 },
    { amountPaise: EXPENSE_AMOUNT_MAX_PAISE + 1 },
    { amountPaise: "45000" },
    { date: "2026-02-30" },
    { date: "10-10-2026" },
    { date: "2026-10-10T00:00:00Z" },
    { paymentMode: "Cash" },
    { paymentMode: "due" },
    { clientRef: "not-a-uuid" },
    { categoryId: "nope" },
    { name: "   " },
    { createdBy: "someone else" },
    { amount: 450 },
  ];
  for (const patch of bad) {
    assert.equal(createExpenseSchema.safeParse({ ...validCreate, ...patch }).success, false, JSON.stringify(patch));
  }
  const { clientRef: _omit, ...noRef } = validCreate;
  assert.equal(createExpenseSchema.safeParse(noRef).success, false, "clientRef is required");
});

test("updateExpenseSchema: needs expectedUpdatedAt and at least one change; '' clears the note", () => {
  const at = "2026-10-10T05:00:00.000Z";
  assert.equal(updateExpenseSchema.safeParse({ expectedUpdatedAt: at }).success, false, "nothing to change");
  assert.equal(updateExpenseSchema.safeParse({ amountPaise: 100 }).success, false, "no expectedUpdatedAt");
  assert.equal(updateExpenseSchema.safeParse({ amountPaise: 100, expectedUpdatedAt: at }).success, true);
  const cleared = updateExpenseSchema.parse({ note: "", expectedUpdatedAt: at });
  assert.equal(cleared.note, "");
  assert.equal(updateExpenseSchema.safeParse({ v: 2, expectedUpdatedAt: at, name: "x" }).success, false, "strict");
});

test("expenseListQuerySchema: coerces the limit and bounds it", () => {
  assert.equal(expenseListQuerySchema.parse({ limit: "100" }).limit, 100);
  assert.equal(expenseListQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(expenseListQuerySchema.safeParse({ limit: "100000" }).success, false);
  assert.equal(expenseListQuerySchema.safeParse({ mode: "cheque" }).success, false);
});

test("category schemas: trimmed name; update needs a change", () => {
  assert.equal(createExpenseCategorySchema.parse({ name: "  Tea  " }).name, "Tea");
  assert.equal(createExpenseCategorySchema.safeParse({ name: "" }).success, false);
  assert.equal(updateExpenseCategorySchema.safeParse({}).success, false);
  assert.equal(updateExpenseCategorySchema.safeParse({ hidden: true }).success, true);
  assert.equal(updateExpenseCategorySchema.safeParse({ hidden: true, displayOrder: 1 }).success, false, "strict");
});
