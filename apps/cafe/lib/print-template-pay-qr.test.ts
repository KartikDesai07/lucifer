import {
  CANCELLED_BILL, FIXED_NOW_MS, MAX_BILL, OVERPAID_BILL, PAID_BILL, UPI_ID,
  billWithQr, expectEncodes, maxSettings, qrCount, renderBill,
} from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { BILL_DESIGNS } from "@pos/shared/print-template";
import { MS_PER_MINUTE, upiPayUri } from "@pos/shared/print-qr";
import { inr } from "@pos/shared/utils";
import type { Order, Settings } from "@/types";
import { loadSlipCode } from "@/components/print/slip/slip-code";

// Print customization S3b (Amendment A4): the bill's "Scan to pay" QR policy, rendered through every design. Split out of
// print-template-matrix-style.test.ts to keep both files under the line cap; the size / align / bold wrappers and the
// link QR rules stay there.

before(() => loadSlipCode()); // R6: the non-Classic designs and the QR encoder are one lazy chunk; load it before rendering
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const settings = maxSettings();
const URL_OK = "https://example.com/menu";
// The pay-QR money rule (S3b replaced S3's "not paid" rule; 01-PLAN Amendment A4). Everything renders at FIXED_NOW_MS
// (14:00 IST, 04 Oct 2026); the helpers pin it explicitly rather than lean on the mocked Date.
const upiHtml = (design: (typeof BILL_DESIGNS)[number], order: Order, s: Settings, now: number = FIXED_NOW_MS): string =>
  renderBill(order, s, billWithQr(design, { content: "upi" }), undefined, now);
const upiCount = (design: (typeof BILL_DESIGNS)[number], order: Order, s: Settings, now: number = FIXED_NOW_MS): number =>
  qrCount(upiHtml(design, order, s, now));
const payUri = (order: Order, amount: number): string =>
  upiPayUri({ upiId: UPI_ID, payee: "Test Cafe", amount, note: `Bill ${order.billNumber}` });
const stamped = (order: Order, minutesBefore: number): Order => ({ ...order, billFirstPrintedAt: new Date(FIXED_NOW_MS - minutesBefore * MS_PER_MINUTE).toISOString() });
const UNPAID_BILL: Order = { ...MAX_BILL, paidAmount: 0 };
const VALID_TILL = "Valid till";
test("(g) UPI QR amount: unpaid = the due, partly paid = exactly what is left, paid or overpaid = the full total, in every design", () => {
  for (const design of BILL_DESIGNS) {
    assert.ok(MAX_BILL.total - MAX_BILL.paidAmount > 0 && MAX_BILL.paidAmount > 0, "landmark: the base order is partly paid");
    expectEncodes(`${design} unpaid`, upiHtml(design, UNPAID_BILL, settings), payUri(UNPAID_BILL, UNPAID_BILL.total));
    expectEncodes(`${design} partial`, upiHtml(design, MAX_BILL, settings), payUri(MAX_BILL, MAX_BILL.total - MAX_BILL.paidAmount));
    expectEncodes(`${design} paid`, upiHtml(design, PAID_BILL, settings), payUri(PAID_BILL, PAID_BILL.total));
    expectEncodes(`${design} overpaid`, upiHtml(design, OVERPAID_BILL, settings), payUri(OVERPAID_BILL, OVERPAID_BILL.total));
  }
  // The default caption names the amount asked for.
  assert.ok(upiHtml("modern", PAID_BILL, settings).includes(`Scan to pay ${inr(PAID_BILL.total)}`), "a paid bill's caption names the full total");
  assert.ok(upiHtml("modern", MAX_BILL, settings).includes(`Scan to pay ${inr(MAX_BILL.total - MAX_BILL.paidAmount)}`), "a partly paid bill's caption names what is left");
});

test("(g) UPI QR prints none for: a cancelled bill, mode Never, mode Only-when-owed on a paid bill, or a bad UPI id - each falsifier alone, in every design", () => {
  for (const design of BILL_DESIGNS) {
    assert.equal(upiCount(design, MAX_BILL, settings), 1, `${design}: landmark: the live, valid-id bill prints one code`);
    assert.equal(upiCount(design, CANCELLED_BILL, settings), 0, `${design}: a cancelled bill (money still owing) prints none`);
    assert.equal(upiCount(design, { ...CANCELLED_BILL, paidAmount: CANCELLED_BILL.total }, settings), 0, `${design}: a cancelled, fully paid bill prints none`);
    assert.equal(upiCount(design, MAX_BILL, maxSettings({ payQrMode: "never" })), 0, `${design}: mode Never prints none`);
    assert.equal(upiCount(design, PAID_BILL, maxSettings({ payQrMode: "never" })), 0, `${design}: mode Never prints none on a paid bill`);
    assert.equal(upiCount(design, MAX_BILL, maxSettings({ payQrMode: "owed" })), 1, `${design}: mode Only-when-owed prints while money is owed`);
    assert.equal(upiCount(design, PAID_BILL, maxSettings({ payQrMode: "owed" })), 0, `${design}: mode Only-when-owed prints none on a paid bill`);
    assert.equal(upiCount(design, OVERPAID_BILL, maxSettings({ payQrMode: "owed" })), 0, `${design}: mode Only-when-owed prints none on an overpaid bill`);
    assert.equal(upiCount(design, PAID_BILL, maxSettings({ payQrMode: "always" })), 1, `${design}: mode Always prints on a paid bill`);
    for (const bad of ["", "bad", "x@y", "no-at-sign.example", "a b@okaxis", "samplecafe@ok.axis"]) {
      assert.equal(upiCount(design, MAX_BILL, maxSettings({ upiId: bad })), 0, `${design}: upiId ${JSON.stringify(bad)} prints none`);
    }
    assert.equal(upiCount(design, MAX_BILL, { ...settings, upiId: undefined }), 0, `${design}: no upiId prints none`);
    assert.equal(upiCount(design, MAX_BILL, maxSettings({ upiId: ` ${UPI_ID} ` })), 1, `${design}: a padded id is trimmed and prints`);
  }
});

test("(g) UPI QR validity: counted from the first print, a reprint after valid-till leaves it off (the TOTAL still prints), exactly at valid-till it prints, No limit never expires", () => {
  for (const design of BILL_DESIGNS) {
    const half = upiHtml(design, stamped(MAX_BILL, 30), settings);
    assert.equal(qrCount(half), 1, `${design}: 30 minutes into a 60-minute window prints`);
    assert.ok(half.includes("Valid till 02:30 pm"), `${design}: and says when it ends (14:00 + 30 min = 02:30 pm IST)`);
    const exact = upiHtml(design, stamped(MAX_BILL, 60), settings);
    assert.equal(qrCount(exact), 1, `${design}: exactly at valid-till it still prints`);
    assert.ok(exact.includes("Valid till 02:00 pm"), `${design}: valid-till is the stamp plus 60 minutes`);
    const late = upiHtml(design, stamped(MAX_BILL, 61), settings);
    assert.equal(qrCount(late), 0, `${design}: one minute past valid-till prints no QR`);
    assert.ok(/total/i.test(late) && late.includes(inr(MAX_BILL.total)) && !late.includes(VALID_TILL), `${design}: the bill itself (its total) still prints, with no Valid till line`);
    const open = upiHtml(design, stamped(MAX_BILL, 3 * 24 * 60), maxSettings({ payQrValidMinutes: 0 }));
    assert.equal(qrCount(open), 1, `${design}: No limit prints on a days-old bill`);
    assert.ok(!open.includes(VALID_TILL), `${design}: and shows no Valid till line`);
    const fresh = upiHtml(design, MAX_BILL, settings);
    assert.ok(fresh.includes("Valid till 03:00 pm"), `${design}: no stamp yet = this print is the first: now + 60 minutes`);
    assert.ok(fresh.indexOf(VALID_TILL) > fresh.indexOf('aria-label="QR code"'), `${design}: the line sits after (under) the code`);
    const nextDay = upiHtml(design, MAX_BILL, maxSettings({ payQrValidMinutes: 1440 }));
    assert.ok(nextDay.includes("Valid till 05 Oct 2026, 02:00 pm"), `${design}: a valid-till on the next cafe day carries the date`);
    assert.ok(!half.includes("Valid till 04 Oct"), `${design}: a same-day valid-till carries no date`);
  }
  // The window comes from Settings: the shortest (5 minutes) lapses on a 6-minute-old stamp, not on a 4-minute-old one.
  assert.equal(upiCount("modern", stamped(MAX_BILL, 6), maxSettings({ payQrValidMinutes: 5 })), 0, "a 5-minute window has lapsed after 6 minutes");
  assert.equal(upiCount("modern", stamped(MAX_BILL, 4), maxSettings({ payQrValidMinutes: 5 })), 1, "and has not after 4");
});

test("(g) the Valid till line uses only black text classes (no opacity, no grey) and a link QR never carries one", () => {
  for (const design of BILL_DESIGNS) {
    const html = upiHtml(design, MAX_BILL, settings);
    const at = html.indexOf(VALID_TILL);
    assert.ok(at > 0, `${design}: landmark: the line prints`);
    const tag = html.slice(html.lastIndexOf("<div", at), at);
    assert.ok(tag.includes("text-black") && !/opacity|gray|neutral|slate|zinc|stone/.test(tag), `${design}: ${tag}`);
    assert.ok(!renderBill(MAX_BILL, settings, billWithQr(design, { content: "link", url: URL_OK }), undefined, FIXED_NOW_MS).includes(VALID_TILL), `${design}: a link QR has no Valid till`);
  }
});
