// F8 — the payment popup keeps the operator's pay mode when the bill changes
// while it is open (a reward arming after Online was picked used to snap it
// back to Cash), and F10 — the Orders/Dashboard sheet loads the popup's chunk
// as it mounts. The rules are pure (lib/payment-result.ts); the pins below hold
// the wiring in PaymentModal, PaymentSummary and OrderDetailSheet.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { paymentPopupChange, splitAfterBillChange } from "./payment-result";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readRaw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(readRaw(rel));
const count = (src: string, needle: string) => src.split(needle).length - 1;

/** The ~300-line file budget (CLAUDE.md). */
const FILE_LINE_BUDGET = 300;

test("paymentPopupChange: opening is 'opened' (even a first mount already open), a total move while open is 'bill-changed', anything else is 'none'", () => {
  // The repro: a reward arms after Online was picked — the total drops while open.
  assert.equal(paymentPopupChange({ open: true, total: 500 }, { open: true, total: 400 }), "bill-changed");
  assert.equal(paymentPopupChange({ open: false, total: 500 }, { open: true, total: 500 }), "opened");
  assert.equal(paymentPopupChange({ open: false, total: 500 }, { open: true, total: 400 }), "opened", "a chunk that arrives late mounts already open");
  assert.equal(paymentPopupChange({ open: true, total: 500 }, { open: true, total: 500 }), "none", "a StrictMode re-run of the same snapshot");
  assert.equal(paymentPopupChange({ open: true, total: 500 }, { open: false, total: 500 }), "none");
  assert.equal(paymentPopupChange({ open: false, total: 500 }, { open: false, total: 400 }), "none");
});

test("splitAfterBillChange keeps the Online part and lets Cash take the rest (never below zero)", () => {
  assert.deepEqual(splitAfterBillChange({ cash: 500, online: 0 }, 400), { cash: 400, online: 0 });
  assert.deepEqual(splitAfterBillChange({ cash: 300, online: 200 }, 400), { cash: 200, online: 200 });
  // The sum no longer matches, so the popup's split mismatch keeps Confirm blocked.
  assert.deepEqual(splitAfterBillChange({ cash: 100, online: 450 }, 400), { cash: 0, online: 450 });
});

test("PIN: PaymentModal resets the pay mode ONLY on the closed-to-open edge, never on a total change", () => {
  const src = readSrc("components/pos/PaymentModal.tsx");
  assert.ok(src.includes("paymentPopupChange("), "landmark: the popup classifies each change");
  assert.equal(count(src, 'setMode("Cash")'), 1, 'setMode("Cash") appears exactly once');
  const opened = src.indexOf('if (change === "opened") {');
  const changed = src.indexOf('} else if (change === "bill-changed") {');
  const reset = src.indexOf('setMode("Cash")');
  assert.ok(opened >= 0 && changed > opened, "landmarks: the opened branch precedes the bill-changed branch");
  assert.ok(reset > opened && reset < changed, "the mode reset lives in the opened branch only");
  assert.ok(!/if \(open\) \{\s*setMode\("Cash"\)/.test(src), "the old reset-on-every-total-change effect must not come back");
  // The split and the "opened with" total reset on the same edge only; a bill
  // change re-derives the split instead (resetting openedTotal there would
  // hide the bill-changed line for good).
  const openedBranch = src.slice(opened, changed);
  for (const needle of ["setSplit({ cash: total, online: 0 })", "setOpenedTotal(total)"]) {
    assert.equal(count(src, needle), 1, `${needle} appears exactly once`);
    assert.ok(openedBranch.includes(needle), `${needle} lives in the opened branch only`);
  }
  assert.equal(count(src, "setOpenedTotal("), 1, "openedTotal is set only as the popup opens");
  const billBranch = src.slice(changed, src.indexOf("}, [open, total]);", changed));
  assert.ok(billBranch.includes("setSplit((s) => splitAfterBillChange(s, total))"), "a bill change re-derives the split");
  const classify = src.indexOf("paymentPopupChange(seenRef.current, { open, total })");
  const remember = src.indexOf("seenRef.current = { open, total };");
  assert.ok(classify >= 0 && remember > classify, "the snapshot is compared first, then remembered");
  // R8: one "bill changed" message at a time — the notice panel wins.
  assert.ok(src.includes("billChangedFrom={notice == null && open && total !== openedTotal ? openedTotal : undefined}"));
  assert.ok(src.includes("<PaymentSummary"), "the summary card is rendered from its own file");
  assert.ok(src.includes("<PaymentSplitFields"), "the split inputs are rendered from their own file");
  assert.ok(src.includes("<WriteNoticePanel notice={notice} />"), "the write outcome shows inside the popup");
  const lines = readRaw("components/pos/PaymentModal.tsx").replace(/\n$/, "").split("\n").length;
  assert.ok(lines <= FILE_LINE_BUDGET, `PaymentModal.tsx must stay within ${FILE_LINE_BUDGET} lines, got ${lines}`);
});

test("PIN: PaymentSummary shows the bill-changed line only when it is handed one", () => {
  const src = readSrc("components/pos/PaymentSummary.tsx");
  assert.ok(src.includes("billChangedFrom !== undefined && ("), "the notice is gated on billChangedFrom");
  assert.ok(src.includes("The bill changed from {inr(billChangedFrom)} to {inr(total)} while this was open."));
});

test("PIN (F10): OrderDetailSheet preloads the PaymentModal chunk once, as it mounts", () => {
  const src = readSrc("components/orders/OrderDetailSheet.tsx");
  const specifier = 'import("@/components/pos/PaymentModal")';
  assert.equal(count(src, specifier), 2, "the dynamic() loader and the mount-time preload");
  const preload = src.indexOf(specifier, src.indexOf(specifier) + 1);
  const effect = src.lastIndexOf("useEffect(() => {", preload);
  const effectEnd = src.indexOf("}, []);", preload);
  assert.ok(effect >= 0 && effectEnd > preload, "the second import sits inside a mount-only useEffect");
  assert.ok(!src.slice(effect, preload).includes("}, ["), "and nothing closes that effect before the import");
});
