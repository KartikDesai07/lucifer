// Print customization S10-A: the GST invoice serial contract (CGST Rule 46(b)). Pure: no DB, no clock beyond the
// instants each case states. The IST/UTC financial-year trap is the one that matters (a bill paid at 23:59 IST on 31
// March must stay in the old year even though UTC already says 1 April is hours away, and the other way round).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FY_START_MONTH,
  INVOICE_NUMBER_MAX_LENGTH,
  INVOICE_SERIAL_DIGITS,
  INVOICE_SERIAL_MAX,
  invoiceFyLabel,
  invoiceFyOf,
  invoiceLabel,
  invoiceLabelOf,
  isInvoiceFy,
  isInvoiceSerial,
} from "./invoice-number";

const SERIAL_SHAPE = /^\d{4}\/\d{6,11}$/;

test("named constants: the FY starts in April, the serial pads to 6, the printed number is at most 16 characters", () => {
  assert.equal(FY_START_MONTH, 4);
  assert.equal(INVOICE_SERIAL_DIGITS, 6);
  assert.equal(INVOICE_NUMBER_MAX_LENGTH, 16);
});

// -- invoiceFyOf: the IST / UTC trap ------------------------------------------

test("invoiceFyOf: 31 Mar 23:59:59 IST (18:29:59Z) is still the OLD year; 1 Apr 00:00:00 IST (18:30:00Z) is the new one", () => {
  assert.equal(invoiceFyOf(new Date("2027-03-31T18:29:59.000Z")), 2026);
  assert.equal(invoiceFyOf(new Date("2027-03-31T18:30:00.000Z")), 2027);
  // The same boundary one year earlier: not a one-off.
  assert.equal(invoiceFyOf(new Date("2026-03-31T18:29:59.999Z")), 2025);
  assert.equal(invoiceFyOf(new Date("2026-03-31T18:30:00.000Z")), 2026);
});

test("invoiceFyOf: a UTC-only reading would be wrong on both sides of the boundary (UTC March, IST April)", () => {
  const lateMarchUtc = new Date("2027-03-31T20:00:00.000Z"); // 01:30 IST on 1 April
  assert.equal(lateMarchUtc.getUTCMonth() + 1, 3, "landmark: UTC still says March");
  assert.equal(invoiceFyOf(lateMarchUtc), 2027, "IST says April, so the new year");
  const earlyAprilUtc = new Date("2027-04-01T00:00:00.000Z"); // 05:30 IST, 1 April: both agree
  assert.equal(invoiceFyOf(earlyAprilUtc), 2027);
});

test("invoiceFyOf: April is the FIRST month of the year (>=, not >) and March the last; the calendar year turn does not change the FY", () => {
  assert.equal(invoiceFyOf(new Date("2026-04-15T06:00:00.000Z")), 2026, "mid April");
  assert.equal(invoiceFyOf(new Date("2026-04-01T06:00:00.000Z")), 2026, "1 April itself belongs to the new year");
  assert.equal(invoiceFyOf(new Date("2026-03-15T06:00:00.000Z")), 2025, "mid March");
  assert.equal(invoiceFyOf(new Date("2026-12-31T06:00:00.000Z")), 2026);
  assert.equal(invoiceFyOf(new Date("2027-01-01T06:00:00.000Z")), 2026, "1 January is still FY 2026-27");
});

test("invoiceFyOf takes exactly one input: the instant (there is no restart-time parameter, the series runs the whole year)", () => {
  assert.equal(invoiceFyOf.length, 1);
  assert.equal(invoiceLabel.length, 2);
});

// -- labels ---------------------------------------------------------------------

test("invoiceFyLabel / invoiceLabel: the two short years, a slash, the number padded to 6", () => {
  assert.equal(invoiceFyLabel(2026), "2627");
  assert.equal(invoiceFyLabel(2025), "2526");
  assert.equal(invoiceLabel(2026, 123), "2627/000123");
  assert.equal(invoiceLabel(2026, 1), "2627/000001");
});

test("invoiceFyLabel: the century turn and a zero-padded year (2099 -> 9900, 2000 -> 0001)", () => {
  assert.equal(invoiceFyLabel(2099), "9900");
  assert.equal(invoiceFyLabel(2000), "0001");
  assert.equal(invoiceFyLabel(2009), "0910");
});

test("invoiceLabel padding: 6 digits wide from 000001; 999999 fits; a 7th digit GROWS the number, never wraps or truncates", () => {
  assert.equal(invoiceLabel(2026, 999999), "2627/999999");
  assert.equal(invoiceLabel(2026, 1000000), "2627/1000000");
  assert.equal(invoiceLabel(2026, 12), "2627/000012");
  assert.match(invoiceLabel(2026, 1), SERIAL_SHAPE);
  assert.match(invoiceLabel(2026, 1000000), SERIAL_SHAPE);
});

test("INVOICE_SERIAL_MAX prints exactly 16 characters, and MAX + 1 is refused by isInvoiceSerial (and would print 17)", () => {
  assert.equal(INVOICE_SERIAL_MAX, 99999999999, "11 digits");
  const atMax = invoiceLabel(2026, INVOICE_SERIAL_MAX);
  assert.equal(atMax.length, INVOICE_NUMBER_MAX_LENGTH);
  assert.equal(atMax, "2627/99999999999");
  assert.match(atMax, SERIAL_SHAPE);
  assert.equal(isInvoiceSerial(INVOICE_SERIAL_MAX), true);
  // Landmark: the label really would overflow Rule 46(b) one past the cap, so the refusal below is not vacuous.
  assert.equal(invoiceLabel(2026, INVOICE_SERIAL_MAX + 1).length, INVOICE_NUMBER_MAX_LENGTH + 1);
  assert.equal(isInvoiceSerial(INVOICE_SERIAL_MAX + 1), false);
});

test("every serial the validator accepts prints within 16 characters and matches the Rule 46(b) shape", () => {
  for (const serial of [1, 9, 10, 999999, 1000000, 12345678, INVOICE_SERIAL_MAX]) {
    assert.equal(isInvoiceSerial(serial), true, `landmark: ${serial} is accepted`);
    const label = invoiceLabel(2026, serial);
    assert.ok(label.length <= INVOICE_NUMBER_MAX_LENGTH, `${label} is ${label.length} characters`);
    assert.match(label, SERIAL_SHAPE);
  }
});

// -- validators -----------------------------------------------------------------

test("isInvoiceSerial: whole numbers from 1 only (0, negatives, fractions, NaN, Infinity and non-numbers are refused)", () => {
  assert.equal(isInvoiceSerial(1), true, "landmark: the lowest serial is accepted");
  for (const bad of [0, -1, 1.5, NaN, Infinity, "1", null, undefined, {}]) {
    assert.equal(isInvoiceSerial(bad), false, `${String(bad)} is refused`);
  }
});

test("isInvoiceFy: a whole four-digit start year whose end year is four digits too (1000..9998)", () => {
  assert.equal(isInvoiceFy(2026), true, "landmark");
  assert.equal(isInvoiceFy(1000), true);
  assert.equal(isInvoiceFy(9998), true);
  for (const bad of [999, 9999, 10000, 0, -2026, 2026.5, NaN, "2026", null, undefined]) {
    assert.equal(isInvoiceFy(bad), false, `${String(bad)} is refused`);
  }
});

// -- invoiceLabelOf -------------------------------------------------------------

test("invoiceLabelOf: the label needs BOTH stored fields; either alone, or neither, is null", () => {
  assert.equal(invoiceLabelOf({ invoiceNumber: 123, invoiceFy: 2026 }), "2627/000123", "landmark: both gives the label");
  assert.equal(invoiceLabelOf({ invoiceNumber: 123 }), null);
  assert.equal(invoiceLabelOf({ invoiceFy: 2026 }), null);
  assert.equal(invoiceLabelOf({}), null);
  assert.equal(invoiceLabelOf({ invoiceNumber: undefined, invoiceFy: undefined }), null);
});

test("invoiceLabelOf: a stored fy is never re-derived — the label follows the stored fy, whatever the clock says", () => {
  assert.equal(invoiceLabelOf({ invoiceNumber: 5, invoiceFy: 2031 }), "3132/000005");
  assert.equal(invoiceLabelOf({ invoiceNumber: 5, invoiceFy: 2031 }), invoiceLabel(2031, 5));
});
