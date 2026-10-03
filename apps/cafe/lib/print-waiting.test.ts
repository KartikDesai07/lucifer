import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
import {
  PRINT_WAITING_TITLES,
  printAlarmMessage,
  printAlarmRows,
  printRetryNotice,
  printWaitingAge,
  printWaitingBadgeOf,
  printWaitingGroups,
  printWaitingName,
  printWaitingReason,
} from "@/lib/print-waiting";

// Printing Phase 1 Session 1D (spec §10, the owner's decision after Session 1B): the one waiting-slips
// panel, its count on the printer button, and the 20 s alarm. Pure rules here; the wiring pins below.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const lines = (s: string): number => s.replace(/\n$/, "").split("\n").length;
const T0 = Date.parse("2026-10-03T12:00:00.000Z");
const ago = (ms: number): string => new Date(T0 - ms).toISOString();

function row(over: Partial<PrintAttentionRow> = {}): PrintAttentionRow {
  return { id: "j1", kind: "kot", label: "KOT round 1 · T-4", status: "queued", labels: [], createdAt: ago(30_000), ...over };
}

test("three groups in plain words, in this order, empty groups left out", () => {
  assert.deepEqual(PRINT_WAITING_TITLES, { printer: "Waiting for the printer", bill: "Check the bill", failed: "Couldn't print" });
  const groups = printWaitingGroups([row({ id: "f", status: "failed" }), row({ id: "q" }), row({ id: "b", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm" })], T0);
  assert.deepEqual(groups.map((g) => [g.group, g.title, g.rows.map((r) => r.row.id)]), [
    ["printer", "Waiting for the printer", ["q"]],
    ["bill", "Check the bill", ["b"]],
    ["failed", "Couldn't print", ["f"]],
  ]);
  assert.deepEqual(printWaitingGroups([], T0), [], "nothing waiting: no panel section");
});

test("each row says how long it has waited and why, without jargon", () => {
  assert.equal(printWaitingAge(ago(30_000), T0), "just now");
  assert.equal(printWaitingAge(ago(5 * 60_000), T0), "5 min");
  assert.equal(printWaitingAge(ago(75 * 60_000), T0), "1 h 15 min");
  assert.equal(printWaitingReason(row({ lastError: PRINTER_NOT_CONNECTED_MESSAGE }), T0), "The printer is off or not connected.");
  assert.equal(printWaitingReason(row({ labels: ["REPRINT"], lastError: PRINTER_NOT_CONNECTED_MESSAGE }), T0), "The printer is off or not connected.", "the printer being off says so first");
  assert.equal(printWaitingReason(row({ status: "failed", lastError: "lease expired: may have printed" }), T0), "Tried twice. Check the printer, then retry.", "server words never reach the screen");
  assert.equal(printWaitingReason(row(), T0), "Not printed yet.");
  assert.equal(printWaitingReason(row({ labels: ["REPRINT"], lastError: "may have printed" }), T0), "Waiting to print again, marked REPRINT.", "after 20 s it is waiting, not printing (gate E2E)");
  assert.equal(printWaitingReason(row({ createdAt: ago(31 * 60_000) }), T0), "Waiting over 30 minutes: print it now, or clear it.");
  assert.equal(printWaitingReason(row({ kind: "bill", status: "needs-confirm" }), T0), "It may already have printed. Check the printer.");
  assert.equal(printWaitingReason(row({ status: "failed", lastError: "This slip is too long to print." }), T0), "This slip is too long to print.");
  assert.equal(printWaitingReason(row({ status: "failed" }), T0), "Tried twice. Check the printer, then retry.");
  for (const r of [row(), row({ status: "failed", lastError: "x" }), row({ kind: "bill", status: "needs-confirm" })]) {
    assert.ok(!/lease|epoch|queue|agent|host/i.test(printWaitingReason(r, T0)), "no jargon on screen");
  }
});

test("the printer button's count: how many slips wait, '20+' when the feed was cut", () => {
  assert.equal(printWaitingBadgeOf(undefined), "", "no pulse yet: no count");
  assert.equal(printWaitingBadgeOf({ printAttention: [] }), "");
  assert.equal(printWaitingBadgeOf({ printAttention: [row(), row({ id: "j2" })] }), "2");
  assert.equal(printWaitingBadgeOf({ printAttention: Array.from({ length: 20 }, (_, i) => row({ id: `j${i}` })), printAttentionTruncated: true }), "20+");
  assert.equal(printWaitingName("Printer connected — open printer setup", ""), "Printer connected — open printer setup", "unchanged with nothing waiting");
  assert.equal(printWaitingName("Printer connected — open printer setup", "1"), "1 slip waiting — open printer setup");
  assert.equal(printWaitingName("Printer connected — open printer setup", "20+"), "20+ slips waiting — open printer setup");
});

test("the 20 s alarm: a KOT this device asked for or prints, and a bill to check; once per slip until it leaves", () => {
  const rows = [
    row({ id: "mine", originDeviceId: "dev-a", targetDeviceId: "host" }),
    row({ id: "printed-here", originDeviceId: "dev-b", targetDeviceId: "dev-a" }),
    row({ id: "other", originDeviceId: "dev-b", targetDeviceId: "host" }),
    row({ id: "bill", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", originDeviceId: "dev-a" }),
    row({ id: "void", kind: "void", originDeviceId: "dev-a" }),
  ];
  assert.deepEqual(printAlarmRows(rows, "dev-a", new Set()).map((r) => r.id), ["mine", "printed-here", "bill"]);
  assert.deepEqual(printAlarmRows(rows, "dev-a", new Set(["mine", "bill"])).map((r) => r.id), ["printed-here"], "rung once per slip");
  assert.deepEqual(printAlarmRows(rows, "", new Set()), [], "no identity: no alarm");
  // The gate's E2E: on a phone the notice covers the top bar, so it carries its own Show button instead of
  // pointing at the printer icon underneath it.
  assert.equal(printAlarmMessage(row()), "KOT round 1 · T-4 has not printed yet.");
  assert.equal(printAlarmMessage(row({ status: "failed" })), "KOT round 1 · T-4 could not print.");
  assert.equal(printAlarmMessage(row({ kind: "bill", label: "Bill · ORD-1", status: "needs-confirm" })), "Bill · ORD-1 may not have printed.");
});

test("a tap's answer in plain words: done, already handled, or it prints by itself when the printer is ready", () => {
  assert.equal(printRetryNotice({ applied: true, status: "queued" }), null, "done: the row leaves on the next tick");
  assert.equal(printRetryNotice({ applied: false, status: "queued", reason: "wrong-status" }), "It prints by itself as soon as the printer is ready.");
  assert.equal(printRetryNotice({ applied: false, status: "printed", reason: "wrong-status" }), "Already handled.");
  assert.equal(printRetryNotice({ applied: false, status: null, reason: "not-found" }), "Already handled.");
});

test("PIN: the panel shows the waiting slips, the button shows their count, and both stay within their budgets", () => {
  const panel = src("apps/cafe/components/print/PrinterPanel.tsx");
  assert.ok(panel.includes("<WaitingSlipsCard pulse={pulse} />"), "the panel lists them");
  assert.ok(panel.indexOf("<WaitingSlipsCard pulse={pulse} />") < panel.indexOf("<PrinterStatusBanner"), "first: what needs a person, before the printer's status and setup");
  const button = src("apps/cafe/components/print/PrinterStatusButton.tsx");
  assert.match(button, /const waiting = usePrintWaitingCount\(\);/, "a narrow context, never the wide pulse");
  assert.match(button, /const name = printWaitingName\(printerButtonName\(dot\), waiting\);/, "the count is part of the button's name");
  assert.match(button, /\{waiting !== "" && \(/, "a count only when slips wait");
  const card = readFileSync(path.join(REPO_ROOT, "apps/cafe/components/print/WaitingSlipsCard.tsx"), "utf8");
  assert.ok(lines(card) <= 120, "WaitingSlipsCard stays <= 120 lines");
  for (const action of ["retry.mutate(", "confirm.mutate(", "dismiss.mutate("]) assert.ok(card.includes(action), `the card offers ${action}`);
  const actions = src("apps/cafe/hooks/use-print-job-actions.ts");
  assert.match(actions, /kickPrintAgent\(\);/, "a tap wakes this device's agent at once (it may be the one that prints)");
  assert.match(actions, /qc\.invalidateQueries\(\{ queryKey: POS_PULSE_KEYS\.all \}\)/, "the panel refreshes after a tap (one request per tap, never a poll)");
});

test("PIN: the alarm rides the pulse already polled (no request), and only the printing lane's drain mounts it", () => {
  const alarm = src("apps/cafe/hooks/use-print-slip-alarm.ts");
  assert.ok(!/apiGet|apiSend|useQuery\(|refetchInterval|setInterval/.test(alarm), "no request and no poll of its own");
  assert.match(alarm, /qc\.getQueryCache\(\)\.subscribe\(/, "it hears each pulse answer");
  assert.match(alarm, /if \(readDevicePrefs\(\)\.alertSound && isAlertSoundUnlocked\(\)\) playAlertPing\(\);/, "the cafe's sound setting decides");
  assert.match(alarm, /action: \{ label: "Show", onClick: openPrinterPanel \}/, "the notice opens the panel itself (it covers the top bar on a phone)");
  assert.match(src("apps/cafe/components/print/PrinterStatusButton.tsx"), /useEffect\(\(\) => onOpenPrinterPanel\(\(\) => setOpen\(true\)\), \[\]\);/, "the printer button opens its sheet when asked");
  assert.match(src("apps/cafe/components/print/PrintHostDrain.tsx"), /usePrintSlipAlarm\(deviceId\);/, "every device with an identity");
});
