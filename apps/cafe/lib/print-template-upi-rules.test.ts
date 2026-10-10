import { FIXED_NOW_MS, MAX_BILL, PAID_BILL, UPI_ID, billWithQr, expectEncodes, maxSettings, qrCount, renderBill } from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { BILL_DESIGNS } from "@pos/shared/print-template";
import { upiPayUri, type UpiRule } from "@pos/shared/print-qr";
import type { Order, Settings } from "@/types";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { billSlipContext } from "@/components/print/slip/slip-context";

// UPI amount slabs on the printed bill: the QR's upi://pay?pa= carries the slab the QR AMOUNT falls in, rendered through
// every design. The maximal bill owes 675 (total 775, 100 paid); a fully paid bill asks the full 775.
before(() => loadSlipCode());
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const SLAB_A = "small.bills@ybl";
const SLAB_B = "mid.bills@paytm";
const OWED = MAX_BILL.total - MAX_BILL.paidAmount;
const settingsWith = (upiRules: unknown, over: Partial<Settings> = {}): Settings =>
  ({ ...maxSettings(over), upiRules }) as unknown as Settings;
const html = (design: (typeof BILL_DESIGNS)[number], order: Order, s: Settings): string =>
  renderBill(order, s, billWithQr(design, { content: "upi" }), undefined, FIXED_NOW_MS);
const payUri = (upiId: string, order: Order, amount: number): string =>
  upiPayUri({ upiId, payee: "Test Cafe", amount, note: `Bill ${order.billNumber}` });

test("slab landmarks: the bill owes less than its total, and the two slab IDs differ from the main one", () => {
  assert.ok(OWED > 0 && OWED < MAX_BILL.total && PAID_BILL.total === MAX_BILL.total);
  assert.equal(new Set([UPI_ID, SLAB_A, SLAB_B]).size, 3);
});

test("a part-paid bill prints the slab its OWED amount falls in, in every design", () => {
  const rules: UpiRule[] = [{ upTo: OWED + 25, upiId: SLAB_A }, { upTo: MAX_BILL.total, upiId: SLAB_B }];
  for (const design of BILL_DESIGNS) {
    expectEncodes(`${design} owed -> slab A`, html(design, MAX_BILL, settingsWith(rules)), payUri(SLAB_A, MAX_BILL, OWED));
  }
});

test("a fully paid bill is sliced by its full total: exactly at a limit uses that slab, one rupee over uses the main ID", () => {
  const atLimit: UpiRule[] = [{ upTo: OWED + 25, upiId: SLAB_A }, { upTo: PAID_BILL.total, upiId: SLAB_B }];
  const over: UpiRule[] = [{ upTo: OWED + 25, upiId: SLAB_A }, { upTo: PAID_BILL.total - 1, upiId: SLAB_B }];
  for (const design of BILL_DESIGNS) {
    expectEncodes(`${design} paid at limit`, html(design, PAID_BILL, settingsWith(atLimit)), payUri(SLAB_B, PAID_BILL, PAID_BILL.total));
    expectEncodes(`${design} paid over limit`, html(design, PAID_BILL, settingsWith(over)), payUri(UPI_ID, PAID_BILL, PAID_BILL.total));
  }
});

test("no slabs, empty slabs, or only invalid slabs print the main-ID code, as before slabs existed", () => {
  const bad = [{ upTo: 700, upiId: "no-at-sign" }, { upTo: 0, upiId: SLAB_A }, { upTo: 10.5, upiId: SLAB_A }];
  for (const design of BILL_DESIGNS) {
    for (const rules of [undefined, [], bad]) {
      expectEncodes(`${design} ${JSON.stringify(rules)}`, html(design, MAX_BILL, settingsWith(rules)), payUri(UPI_ID, MAX_BILL, OWED));
    }
  }
});

test("a slab ID is trimmed, and the context reads slabs through the lenient reader (sorted, bad dropped)", () => {
  const ctx = billSlipContext(MAX_BILL, settingsWith([{ upTo: 2000, upiId: SLAB_B }, { upTo: 500, upiId: ` ${SLAB_A} ` }, { upTo: 9, upiId: "x" }]));
  assert.deepEqual(ctx.upiRules, [{ upTo: 500, upiId: SLAB_A }, { upTo: 2000, upiId: SLAB_B }]);
  assert.deepEqual(billSlipContext(MAX_BILL, maxSettings()).upiRules, []);
  expectEncodes("trimmed", html("modern", MAX_BILL, settingsWith([{ upTo: 700, upiId: ` ${SLAB_A} ` }])), payUri(SLAB_A, MAX_BILL, OWED));
});

test("a slab never turns a pay QR on: mode Never and a cancelled bill still print none", () => {
  const rules: UpiRule[] = [{ upTo: 1000, upiId: SLAB_A }];
  assert.equal(qrCount(html("modern", MAX_BILL, settingsWith(rules))), 1, "landmark: the slab bill prints one code");
  assert.equal(qrCount(html("modern", MAX_BILL, settingsWith(rules, { payQrMode: "never" }))), 0);
  assert.equal(qrCount(html("modern", { ...MAX_BILL, status: "Cancelled" }, settingsWith(rules))), 0);
});
