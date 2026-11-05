import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import { printAlarmStep } from "@/lib/print-waiting";
import { onPrinterPanelOpenChange, printerPanelIsOpen, reportPrinterPanelOpen, setPrinterPanelOpen } from "@/lib/printer-panel-open";

// PX-2 Task 7 (spec §6.9 B5, §14 R12, §15 F-M8): the 20 s alarm's toast never covers the open printer panel. While it is
// open the step shows nothing (the ping still plays for a slip that newly waits) and remembers each slip quietly, so
// nothing pops after the close for a slip staff saw there. Pure rules here; the wiring pins below.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const T0 = Date.parse("2026-11-05T12:00:00.000Z");
const ago = (ms: number): string => new Date(T0 - ms).toISOString();
const feedOf = (rows: PrintAttentionRow[], truncated = false) => ({ rows, truncated });

function row(over: Partial<PrintAttentionRow> = {}): PrintAttentionRow {
  return { id: "k", kind: "kot", label: "KOT round 1 · T-4", status: "queued", labels: [], createdAt: ago(30_000), originDeviceId: "dev-a", ...over };
}

test("quiet shows nothing and remembers it quietly", () => {
  const step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false, true);
  assert.deepEqual(step.show, [], "no toast over the open panel");
  assert.equal(step.memory.get("k")?.shown, false, "remembered without a notice");
  assert.equal(step.ring, true, "the ping still plays for a slip that newly waits");
  assert.deepEqual(step.dismiss, [], "nothing to take down");
});

test("after the panel closes the same slip does not pop", () => {
  let step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false, true);
  step = printAlarmStep(step.memory, feedOf([row()]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.show, [], "staff saw it in the panel: no toast after the close");
  assert.equal(step.ring, false, "and no second ping");
  step = printAlarmStep(step.memory, feedOf([row({ problem: "paper-out", printerId: "p1" })]), "dev-a", T0 + 40_000, false);
  assert.deepEqual(step.show, [], "its printer's problem changing re-words only a notice that is up");
});

test("a slip that gets worse after the close rings and shows", () => {
  let step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false, true);
  step = printAlarmStep(step.memory, feedOf([row()]), "dev-a", T0 + 20_000, false);
  step = printAlarmStep(step.memory, feedOf([row({ status: "failed" })]), "dev-a", T0 + 40_000, false);
  assert.equal(step.ring, true, "queued -> failed rings again");
  assert.deepEqual(step.show.map((r) => r.id), ["k"], "and shows its notice");
});

test("a slip that gets worse while the panel is open rings, quietly", () => {
  let step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false, true);
  step = printAlarmStep(step.memory, feedOf([row({ status: "failed" })]), "dev-a", T0 + 20_000, false, true);
  assert.equal(step.ring, true, "it got worse: the ping plays");
  assert.deepEqual(step.show, [], "but no toast covers the panel");
  step = printAlarmStep(step.memory, feedOf([row({ status: "failed" })]), "dev-a", T0 + 40_000, false);
  assert.deepEqual(step.show, [], "nor after the close");
});

test("quiet hides the summary", () => {
  const rows = [row({ id: "a" }), row({ id: "b" })];
  let step = printAlarmStep(new Map(), feedOf(rows), "dev-a", T0, true, true);
  assert.equal(step.summaryWaiting, 0, "no summary over the open panel");
  assert.deepEqual(step.show, [], "and no notice per slip");
  step = printAlarmStep(step.memory, feedOf(rows), "dev-a", T0 + 20_000, false);
  assert.equal(step.summaryWaiting, 0, "the panel listed them: the summary does not come back after the close");
  assert.deepEqual(step.show, [], "nor a notice per slip");
});

test("a page's summary seen in the open panel does not come back after the close", () => {
  const rows = [row({ id: "a" }), row({ id: "b" })];
  let step = printAlarmStep(new Map(), feedOf(rows), "dev-a", T0, true);
  assert.equal(step.summaryWaiting, 2, "landmark: the page opened while two waited");
  step = printAlarmStep(step.memory, feedOf(rows), "dev-a", T0 + 20_000, false, true);
  assert.equal(step.summaryWaiting, 0, "the panel is open: the summary goes");
  step = printAlarmStep(step.memory, feedOf(rows), "dev-a", T0 + 40_000, false);
  assert.equal(step.summaryWaiting, 0, "and stays gone after the close");
});

test("F-M8: a slip recorded quietly that leaves the feed for a moment and comes back gets no notice either", () => {
  let step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false, true);
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 20_000, false, true);
  assert.deepEqual(step.dismiss, [], "nothing was up to take down");
  step = printAlarmStep(step.memory, feedOf([row()]), "dev-a", T0 + 40_000, false);
  assert.deepEqual(step.show, [], "back from a refused lease after the close: no notice");
  assert.equal(step.ring, false, "and no ping");
});

test("a notice that came down when its slip left, back while the panel is open, stays down after the close", () => {
  let step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false);
  assert.deepEqual(step.show.map((r) => r.id), ["k"], "landmark: its notice showed");
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.dismiss, ["k"], "leased for a moment: its notice went");
  step = printAlarmStep(step.memory, feedOf([row()]), "dev-a", T0 + 40_000, false, true);
  assert.deepEqual(step.show, [], "back while the panel is open: no toast over it");
  assert.equal(step.memory.get("k")?.shown, false, "recorded without a notice");
  step = printAlarmStep(step.memory, feedOf([row()]), "dev-a", T0 + 60_000, false);
  assert.deepEqual(step.show, [], "staff saw it in the panel: nothing pops after the close");
});

test("not quiet: today's alarm, unchanged", () => {
  const step = printAlarmStep(new Map(), feedOf([row()]), "dev-a", T0, false, false);
  assert.deepEqual(step.show.map((r) => r.id), ["k"], "a new waiting KOT shows its notice");
  assert.equal(step.memory.get("k")?.shown, true, "remembered with it");
  const first = printAlarmStep(new Map(), feedOf([row({ id: "a" })]), "dev-a", T0, true);
  assert.equal(first.summaryWaiting, 1, "a page that opens while a slip waits still shows the summary");
});

test("the panel's open state: set, read, heard on change only, and cleared by the report's cleanup (R12)", () => {
  const heard: boolean[] = [];
  const off = onPrinterPanelOpenChange((open) => heard.push(open));
  assert.equal(printerPanelIsOpen(), false, "closed until a button says otherwise");
  setPrinterPanelOpen(true);
  setPrinterPanelOpen(true);
  assert.equal(printerPanelIsOpen(), true, "open");
  const clear = reportPrinterPanelOpen(true);
  clear();
  assert.equal(printerPanelIsOpen(), false, "the button's cleanup (a close, an unmount) leaves it closed");
  assert.deepEqual(heard, [true, false], "each change heard once");
  off();
  setPrinterPanelOpen(true);
  assert.deepEqual(heard, [true, false], "an unsubscribed listener hears nothing");
  setPrinterPanelOpen(false);
});

test("PIN (B5): the alarm is quiet while the panel is open and takes its notices down at the open; the button reports both paths", () => {
  const alarm = src("apps/cafe/hooks/use-print-slip-alarm.ts");
  assert.ok(alarm.includes("printAlarmStep(page.memory, { rows, truncated: data?.printAttentionTruncated === true }, deviceId, Date.now(), !page.seeded, printerPanelIsOpen());"), "check passes quiet while the panel is open");
  const open = alarm.slice(alarm.indexOf("onPrinterPanelOpenChange("), alarm.indexOf("return () => {"));
  assert.ok(open.includes("if (!open) return;"), "only an open takes notices down");
  assert.ok(open.includes("toast.dismiss(SUMMARY_ID);") && open.includes("page.summary = 0;"), "the summary goes at the open");
  assert.ok(open.includes("toast.dismiss(`print-alarm-${id}`);") && open.includes("shown: false"), "every notice up goes, remembered shown: false");
  assert.ok(alarm.includes("offOpen();"), "the open listener goes with the hook");
  const panelOpen = src("apps/cafe/lib/printer-panel-open.ts");
  assert.ok(panelOpen.includes("window.dispatchEvent(new Event(OPEN_PRINTER_PANEL_EVENT));"), "R12: the alarm's Show still opens the sheet by its event");
  const button = src("apps/cafe/components/print/PrinterStatusButton.tsx");
  assert.ok(button.includes("useLayoutEffect(() => reportPrinterPanelOpen(open), [open]);"), "the sheet's own open state is reported: the trigger, the alarm's Show and a close alike, cleared on unmount");
});
