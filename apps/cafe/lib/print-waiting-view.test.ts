import { test } from "node:test";
import assert from "node:assert/strict";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { PRINTER_GONE_MESSAGE, PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
import { NOT_PRINTED_ACTION_WORDS, notPrintedViewOf, withoutAttentionRows } from "@/lib/print-waiting-view";

// PX-2 Task 3 (spec §6.3): the Not printed card's rows, words and buttons, pure.

const T0 = Date.parse("2026-11-05T12:00:00.000Z");
const min = (n: number): string => new Date(T0 - n * 60_000).toISOString();
const PRINTERS = [{ id: "p1", name: "Kitchen printer" }];
const DESKTOP = "No printer is chosen for this PC. Open Settings, then Printing, and pick the printer.";
const DESKTOP_SHOWN = "No printer is chosen for this PC. Open the printer icon, then Printer settings, and choose the printer.";

function row(over: Partial<PrintAttentionRow> = {}): PrintAttentionRow {
  return { id: "j1", kind: "kot", label: "KOT round 1 · T-4", status: "queued", labels: [], createdAt: min(1), ...over };
}
function one(over: Partial<PrintAttentionRow>) {
  const view = notPrintedViewOf([row(over)], false, T0, PRINTERS);
  assert.ok(view !== null, "a row gives a card");
  return view.rows[0]!;
}

test("no row, no card", () => {
  assert.equal(notPrintedViewOf([], false, T0, PRINTERS), null, "nothing waits: no card");
});

test("the words of each kind of slip", () => {
  const bill = one({ status: "needs-confirm" });
  assert.deepEqual([bill.strong, bill.reason, bill.tone, bill.actions], ["May have printed.", "Check the printer.", "warn", ["print-again", "it-printed", "clear"]], "bill");
  const failed = one({ status: "failed" });
  assert.deepEqual([failed.strong, failed.reason, failed.tone, failed.actions], ["Could not print.", "", "bad", ["try-again", "clear"]], "failed with no safe words");
  const desk = one({ status: "failed", lastError: DESKTOP });
  assert.equal(desk.reason, DESKTOP_SHOWN, "a failed row's own safe words, shown as the new pointer");
  const old = one({ createdAt: min(31) });
  assert.deepEqual([old.strong, old.reason, old.tone, old.actions], [null, "Waiting over 30 min.", null, ["print-now", "clear"]], "stale");
  const tapped = one({ createdAt: min(31), approved: true });
  assert.deepEqual([tapped.reason, tapped.actions], ["Waits for the printer.", ["clear"]], "approved is never over 30");
  assert.equal(one({ lastError: RASTER_FAILED_MESSAGE }).reason, "Could not be prepared. Tries once more by itself.", "slip refusal");
  assert.equal(one({ printerId: "p1", problem: "paper-out" }).reason, "Kitchen printer is out of paper.", "problem");
  assert.equal(one({ labels: ["REPRINT"] }).reason, "Prints again, marked REPRINT.", "reprint");
  assert.equal(one({ labels: ["DUPLICATE"] }).reason, "Prints again, marked DUPLICATE.", "duplicate");
  assert.equal(one({ lastError: PRINTER_NOT_CONNECTED_MESSAGE }).reason, "The printer is off or not connected.", "sent nothing");
  assert.equal(one({ lastError: DESKTOP }).reason, DESKTOP_SHOWN, "windows refusal, shown as the new pointer");
  assert.equal(one({}).reason, "Waits for the printer.", "plain");
  assert.equal(one({ printerId: "p1" }).reason, "Waits for Kitchen printer.", "plain, named");
  assert.equal(one({ printerId: "zz" }).reason, "Waits for the printer.", "unknown name");
  assert.equal(one({}).age, "1 min", "age");
});

test("a slip whose printer is gone shows no print button", () => {
  const msg = "No printer takes it now. Print it again from its order.";
  const a = one({ status: "failed", printerId: PRINT_JOB_NO_PRINTER });
  assert.deepEqual([a.strong, a.reason, a.tone, a.actions], [null, msg, "bad", ["clear"]], "failed, no printer");
  assert.deepEqual([one({ status: "failed", lastError: PRINTER_GONE_MESSAGE }).reason, one({ status: "failed", lastError: PRINTER_GONE_MESSAGE }).actions], [msg, ["clear"]], "failed, gone message");
  const bill = one({ status: "needs-confirm", printerId: PRINT_JOB_NO_PRINTER });
  assert.deepEqual([bill.reason, bill.tone, bill.actions], [msg, "warn", ["it-printed", "clear"]], "bill on a gone printer");
  const missing = one({ status: "failed", printerId: "not-in-list" });
  assert.deepEqual(missing.actions, ["try-again", "clear"], "missing from the cached list only: today's buttons (R3)");
});

test("no print button on a slip that prints by itself", () => {
  for (const over of [{}, { approved: true as const, createdAt: min(90) }, { labels: ["REPRINT" as const] }, { lastError: PRINTER_NOT_CONNECTED_MESSAGE }, { printerId: "p1", problem: "offline" as const }]) {
    assert.deepEqual(one(over).actions, ["clear"], "clear only");
  }
});

test("the ones that need a person first, newest first", () => {
  const rows = [row({ id: "A", createdAt: min(4) }), row({ id: "B", status: "needs-confirm", createdAt: min(2) }), row({ id: "C", status: "failed", createdAt: min(14) }), row({ id: "D", createdAt: min(1) })];
  const view = notPrintedViewOf(rows, false, T0, PRINTERS)!;
  assert.deepEqual(view.rows.map((r) => r.id), ["B", "C", "D", "A"], "bills, failed, then waiting; newest first");
  assert.deepEqual(view.ids, ["B", "C", "D", "A"], "ids in shown order");
});

test("the summary", () => {
  assert.equal(notPrintedViewOf([row()], false, T0, [])!.summary, "They print by themselves when the printer is ready.", "queued only");
  assert.equal(notPrintedViewOf([row(), row({ id: "j2", status: "failed" })], false, T0, [])!.summary, "Tap a button on the ones that need you.", "needs you");
  assert.equal(notPrintedViewOf([row()], true, T0, [])!.summary, "The newest 20. They print by themselves when the printer is ready.", "truncated");
});

test("the badge and the ids", () => {
  const rows = Array.from({ length: 7 }, (_, i) => row({ id: `r${i}` }));
  assert.equal(notPrintedViewOf(rows, false, T0, [])!.badge, "7", "count");
  assert.equal(notPrintedViewOf(rows, true, T0, [])!.badge, "7+", "cut");
  assert.equal(NOT_PRINTED_ACTION_WORDS["print-again"], "Print again", "words");
  assert.equal(NOT_PRINTED_ACTION_WORDS["it-printed"], "It printed", "words");
  assert.equal(NOT_PRINTED_ACTION_WORDS["try-again"], "Try again", "words");
  assert.equal(NOT_PRINTED_ACTION_WORDS["print-now"], "Print now", "words");
  assert.equal(NOT_PRINTED_ACTION_WORDS.clear, "Clear", "words");
});

test("withoutAttentionRows", () => {
  const data = { other: 1, printAttention: [row({ id: "a" }), row({ id: "b" })] };
  const out = withoutAttentionRows(data, new Set(["a"]))!;
  assert.deepEqual(out.printAttention.map((r) => r.id), ["b"], "removed");
  assert.equal(out.other, 1, "other fields kept");
  assert.equal(withoutAttentionRows(data, new Set(["zz"])), data, "same object when nothing is removed");
  assert.equal(withoutAttentionRows(undefined, new Set(["a"])), undefined, "undefined stays");
});

test("first match wins, in the spec's order (final review)", () => {
  assert.equal(one({ labels: ["REPRINT"], lastError: PRINTER_NOT_CONNECTED_MESSAGE }).reason, "Prints again, marked REPRINT.", "marked beats sent nothing");
  assert.equal(one({ lastError: RASTER_FAILED_MESSAGE, printerId: "p1", problem: "paper-out" }).reason, "Could not be prepared. Tries once more by itself.", "slip refusal beats a printer problem");
  assert.equal(one({ printerId: "p1", problem: "paper-out", labels: ["DUPLICATE"] }).reason, "Kitchen printer is out of paper.", "problem beats marked");
});

test("the summary asks for a tap when a slip needs one (Ruling T)", () => {
  const stale = [row({ id: "a", createdAt: min(40) }), row({ id: "b", createdAt: min(50) })];
  assert.equal(notPrintedViewOf(stale, false, T0, [])!.summary, "Tap a button on the ones that need you.", "only stale untapped slips");
  const fresh = [row({ id: "a" }), row({ id: "b", createdAt: min(50), approved: true })];
  assert.equal(notPrintedViewOf(fresh, false, T0, [])!.summary, "They print by themselves when the printer is ready.", "fresh or approved");
});
