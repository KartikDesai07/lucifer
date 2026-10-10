// E1 (Expenses UI v2) — the alert band's visibility: the print-host block
// renders on the Dashboard only (CB-UI2), so off it the print state must not
// open an EMPTY amber band.
import assert from "node:assert/strict";
import test from "node:test";

import { alertBandVisible, type AlertBandVisibleInput } from "./alert-bar-scope";

const QUIET: AlertBandVisibleInput = { suppressed: false, onDashboard: false, openCount: 0, unprintedCount: 0, printBand: false };

test("alertBandVisible: print state alone off the Dashboard opens NO band (the empty yellow strip)", () => {
  assert.equal(alertBandVisible({ ...QUIET, printBand: true }), false);
});

test("alertBandVisible: print state on the Dashboard shows the band", () => {
  assert.equal(alertBandVisible({ ...QUIET, onDashboard: true, printBand: true }), true);
});

test("alertBandVisible: nothing to say -> hidden on every path", () => {
  assert.equal(alertBandVisible(QUIET), false);
  assert.equal(alertBandVisible({ ...QUIET, onDashboard: true }), false);
});

test("alertBandVisible: open requests / unprinted self-orders show on every non-suppressed path", () => {
  for (const onDashboard of [true, false]) {
    assert.equal(alertBandVisible({ ...QUIET, onDashboard, openCount: 1 }), true);
    assert.equal(alertBandVisible({ ...QUIET, onDashboard, unprintedCount: 2 }), true);
  }
});

test("alertBandVisible: suppressed (POS) is always hidden, whatever else is true", () => {
  for (const onDashboard of [true, false]) {
    assert.equal(
      alertBandVisible({ suppressed: true, onDashboard, openCount: 3, unprintedCount: 3, printBand: true }),
      false,
    );
  }
});
