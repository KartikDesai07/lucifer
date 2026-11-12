import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";
import { STOCK_ENTRY_MAX_TOTAL_PAISE, STOCK_QTY_MAX_MILLI, STOCK_RATE_MAX_PAISE } from "@pos/shared/inventory";
import { DUE_NEEDS_SUPPLIER_ERROR, PAID_OVER_TOTAL_ERROR } from "@/schemas";
import { PURCHASE_TOTAL_TOO_BIG_ERROR, purchaseMoneyError, purchaseSameAs, purchaseSums } from "./purchase";

// Inventory lite Slice 5: the pure sums, money re-checks and replay same-check of a purchase. Pure and DB-free.

const MILK = "665f0000000000000000b001";
const SUGAR = "665f0000000000000000b002";
const SUPPLIER = "665f0000000000000000d001";

test("purchaseSums: each line rounds ONCE, the total is the sum of the rounded lines, due is total minus paid", () => {
  const sums = purchaseSums({
    lines: [
      { itemId: MILK, qtyMilli: 1500, ratePaise: 4000 },
      { itemId: SUGAR, qtyMilli: 333, ratePaise: 50 },
    ],
    paidPaise: 5000,
  });
  assert.deepEqual(sums.lines, [
    { itemId: MILK, qty: 1500, ratePaise: 4000, amountPaise: 6000 },
    { itemId: SUGAR, qty: 333, ratePaise: 50, amountPaise: 17 }, // 16.65 rounds to 17
  ]);
  assert.deepEqual([sums.totalPaise, sums.paidPaise, sums.duePaise], [6017, 5000, 1017]);
});

test("purchaseSums: two half-paise lines each round up (sum of rounded lines, not a rounded sum); a free line is 0", () => {
  const sums = purchaseSums({
    lines: [
      { itemId: MILK, qtyMilli: 500, ratePaise: 1 },
      { itemId: SUGAR, qtyMilli: 500, ratePaise: 1 },
    ],
    paidPaise: 0,
  });
  assert.deepEqual(sums.lines.map((l) => l.amountPaise), [1, 1]);
  assert.equal(sums.totalPaise, 2);
  const free = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: 2000, ratePaise: 0 }], paidPaise: 0 });
  assert.deepEqual([free.totalPaise, free.duePaise], [0, 0]);
});

test("purchaseSums: paid over the total gives a negative due (the money check refuses it)", () => {
  const sums = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: 1000, ratePaise: 100 }], paidPaise: 150 });
  assert.equal(sums.duePaise, -50);
});

test("purchaseMoneyError: fine when paid in full without a supplier, or part paid WITH one", () => {
  const full = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: 1000, ratePaise: 100 }], paidPaise: 100 });
  assert.equal(purchaseMoneyError(full, undefined), null);
  const part = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: 1000, ratePaise: 100 }], paidPaise: 40 });
  assert.equal(purchaseMoneyError(part, SUPPLIER), null);
  assert.equal(purchaseMoneyError(part, undefined), DUE_NEEDS_SUPPLIER_ERROR, "landmark: the same sums without a supplier are refused");
});

test("purchaseMoneyError: paid over the total is refused, with or without a supplier", () => {
  const over = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: 1000, ratePaise: 100 }], paidPaise: 101 });
  assert.equal(purchaseMoneyError(over, SUPPLIER), PAID_OVER_TOTAL_ERROR);
  assert.equal(purchaseMoneyError(over, undefined), PAID_OVER_TOTAL_ERROR);
});

test("purchaseMoneyError: a total over the cap is refused FIRST", () => {
  const big = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: STOCK_QTY_MAX_MILLI, ratePaise: STOCK_RATE_MAX_PAISE }], paidPaise: 0 });
  assert.ok(big.totalPaise > STOCK_ENTRY_MAX_TOTAL_PAISE, "landmark: the fixture is over the cap");
  assert.equal(purchaseMoneyError(big, undefined), PURCHASE_TOTAL_TOO_BIG_ERROR, "before the due-needs-supplier rule");
  const under = purchaseSums({ lines: [{ itemId: MILK, qtyMilli: 1000, ratePaise: 100 }], paidPaise: 100 });
  assert.equal(purchaseMoneyError(under, undefined), null, "landmark: a total under the cap is fine");
});

const first = {
  supplierId: new Types.ObjectId(SUPPLIER),
  paidPaise: 40,
  lines: [
    { itemId: new Types.ObjectId(MILK), qty: 1000, ratePaise: 100 },
    { itemId: new Types.ObjectId(SUGAR), qty: 500, ratePaise: 20 },
  ],
};
const same = {
  supplierId: SUPPLIER,
  paidPaise: 40,
  lines: [
    { itemId: MILK, qtyMilli: 1000, ratePaise: 100 },
    { itemId: SUGAR, qtyMilli: 500, ratePaise: 20 },
  ],
};

test("purchaseSameAs: the same supplier, paid and lines in order are the same purchase", () => {
  assert.equal(purchaseSameAs(first, same), true);
  assert.equal(purchaseSameAs({ ...first, supplierId: undefined }, { ...same, supplierId: undefined }), true, "both without a supplier");
});

test("purchaseSameAs: any difference is a different purchase", () => {
  const cases: [string, Parameters<typeof purchaseSameAs>[0], Parameters<typeof purchaseSameAs>[1]][] = [
    ["supplier added", { ...first, supplierId: undefined }, same],
    ["supplier dropped", first, { ...same, supplierId: undefined }],
    ["another supplier", first, { ...same, supplierId: "665f0000000000000000d002" }],
    ["paid", first, { ...same, paidPaise: 41 }],
    ["qty", first, { ...same, lines: [{ ...same.lines[0], qtyMilli: 1001 }, same.lines[1]] }],
    ["rate", first, { ...same, lines: [same.lines[0], { ...same.lines[1], ratePaise: 21 }] }],
    ["item", first, { ...same, lines: [same.lines[0], { ...same.lines[1], itemId: MILK }] }],
    ["order", first, { ...same, lines: [same.lines[1], same.lines[0]] }],
    ["a line dropped", first, { ...same, lines: [same.lines[0]] }],
    ["a line added", { ...first, lines: [first.lines[0]] }, same],
  ];
  for (const [label, row, cmd] of cases) assert.equal(purchaseSameAs(row, cmd), false, label);
});

test("purchaseSameAs: a stored row without paidPaise reads as 0 paid", () => {
  assert.equal(purchaseSameAs({ ...first, paidPaise: undefined }, { ...same, paidPaise: 0 }), true);
});
