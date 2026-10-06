import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINTER_NOT_CONNECTED_MESSAGE } from "@/lib/printer/web-printer-types";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
import {
  PRINT_ALARM_FORGET_MS,
  PRINT_WAITING_TITLES,
  printAlarmMessage,
  printAlarmStep,
  printAlarmSummary,
  printAlarmWanted,
  printRetryNotice,
  printerNameOf,
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
  // The 1D gate (M-5) changed this deliberately: the printer's own state stays in the name.
  assert.equal(printWaitingName("Printer connected — open printer setup", "1"), "1 slip waiting · Printer connected — open printer setup");
  assert.equal(printWaitingName("Printer not connected — open printer setup", "20+"), "20+ slips waiting · Printer not connected — open printer setup");
});

test("the 1D gate (M-6): a slip refused once for itself is not blamed on the printer; a slip staff already tapped is not stale", () => {
  assert.equal(printWaitingReason(row({ lastError: RASTER_FAILED_MESSAGE }), T0), "The slip could not be prepared. It tries once more by itself.");
  assert.equal(printWaitingReason(row({ createdAt: ago(31 * 60_000), approved: true }), T0), "Waiting for the printer.", "Print now was tapped: it waits for its printer, not for a tap");
  assert.equal(printWaitingReason(row({ createdAt: ago(31 * 60_000), approved: true, lastError: PRINTER_NOT_CONNECTED_MESSAGE }), T0), "The printer is off or not connected.");
  assert.equal(printWaitingReason(row({ createdAt: ago(31 * 60_000) }), T0), "Waiting over 30 minutes: print it now, or clear it.", "never tapped: still asks for a tap");
});

test("the Phase 1 final gate (I-3): a Windows app refusal says what to fix on the PC, in the app's own words", () => {
  const noPrinter = "No printer is chosen for this PC. Open Settings, then Printing, and pick the printer.";
  assert.equal(printWaitingReason(row({ lastError: noPrinter }), T0), noPrinter, "not 'the printer is off': it is not chosen");
  assert.equal(printWaitingReason(row({ lastError: "The chosen printer was not found on this PC. Open Settings, then Printing, and pick it again." }), T0), "The chosen printer was not found on this PC. Open Settings, then Printing, and pick it again.");
  assert.equal(printWaitingReason(row({ lastError: "The slip did not finish drawing. Print it again." }), T0), "The slip could not be prepared. It tries once more by itself.", "the slip's own refusal, as on the other lanes");
});

// The 1D gate changed the alarm deliberately (N-2, N-4, N-5, M-1): printAlarmRows became printAlarmWanted
// plus printAlarmStep, one pulse of a remembered alarm.
const feedOf = (rows: PrintAttentionRow[], truncated = false) => ({ rows, truncated });

test("the 20 s alarm is for the asking and the printing device: a KOT, a bill to check, and any slip that could not print", () => {
  const rows = [
    row({ id: "mine", originDeviceId: "dev-a", targetDeviceId: "host" }),
    row({ id: "printed-here", originDeviceId: "dev-b", targetDeviceId: "dev-a" }),
    row({ id: "other", originDeviceId: "dev-b", targetDeviceId: "host" }),
    row({ id: "bill", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", originDeviceId: "dev-a" }),
    row({ id: "void", kind: "void", originDeviceId: "dev-a" }),
    row({ id: "void-failed", kind: "void", status: "failed", originDeviceId: "dev-a" }),
    row({ id: "bill-queued", kind: "bill", label: "Bill · ORD-2", originDeviceId: "dev-a" }),
  ];
  assert.deepEqual(rows.filter((r) => printAlarmWanted(r, "dev-a")).map((r) => r.id), ["mine", "printed-here", "bill", "void-failed"], "a notice that could not print matters too (N-10)");
  assert.deepEqual(rows.filter((r) => printAlarmWanted(r, "")), [], "no identity: no alarm");
  assert.equal(printAlarmSummary(1), "1 slip still waiting. Open the printer panel to check.");
  assert.equal(printAlarmSummary(3), "3 slips still waiting. Open the printer panel to check.");
  // The gate's E2E: on a phone the notice covers the top bar, so it carries its own Show button instead of
  // pointing at the printer icon underneath it.
  assert.equal(printAlarmMessage(row()), "KOT round 1 · T-4 has not printed yet.");
  assert.equal(printAlarmMessage(row({ status: "failed" })), "KOT round 1 · T-4 could not print.");
  assert.equal(printAlarmMessage(row({ kind: "bill", label: "Bill · ORD-1", status: "needs-confirm" })), "Bill · ORD-1 may not have printed.");
});

test("the alarm rings once per slip, again only when it gets worse, and goes quietly when staff act on it (N-4)", () => {
  const kot = row({ id: "k", originDeviceId: "dev-a" });
  let step = printAlarmStep(new Map(), feedOf([kot]), "dev-a", T0, false);
  assert.equal(step.ring, true, "a new waiting KOT rings");
  assert.deepEqual(step.show.map((r) => r.id), ["k"], "and shows its notice");
  step = printAlarmStep(step.memory, feedOf([kot]), "dev-a", T0 + 20_000, false);
  assert.equal(step.ring, false, "once per slip");
  assert.deepEqual(step.show, [], "no second notice");
  step = printAlarmStep(step.memory, feedOf([row({ id: "k", status: "failed", originDeviceId: "dev-a" })]), "dev-a", T0 + 40_000, false);
  assert.equal(step.ring, true, "worse: it could not print, so it rings again");
  assert.deepEqual(step.show.map((r) => r.status), ["failed"], "the notice is re-worded (same id)");
  step = printAlarmStep(step.memory, feedOf([row({ id: "k", originDeviceId: "dev-a", approved: true })]), "dev-a", T0 + 60_000, false);
  assert.equal(step.ring, false, "staff tapped Retry: no ring for the slip they just acted on");
  assert.deepEqual(step.dismiss, ["k"], "its notice goes quietly");
  step = printAlarmStep(step.memory, feedOf([row({ id: "k", status: "failed", originDeviceId: "dev-a" })]), "dev-a", T0 + 80_000, false);
  assert.equal(step.ring, true, "it failed again: rings again");
  const bill = row({ id: "b", kind: "bill", label: "Bill · ORD-1", status: "needs-confirm", originDeviceId: "dev-a" });
  step = printAlarmStep(new Map(), feedOf([bill]), "dev-a", T0, false);
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.dismiss, ["b"], "Print again: the bill left the feed while it prints, so its notice goes");
  step = printAlarmStep(step.memory, feedOf([{ ...bill, status: "failed" }]), "dev-a", T0 + 40_000, false);
  assert.equal(step.ring, true, "the cashier hears when the DUPLICATE could not print either (N-4)");
});

test("the alarm forgets a slip a minute after it left; a slip merely being printed for a moment comes back without ringing (M-1)", () => {
  const kot = row({ id: "k", originDeviceId: "dev-a" });
  let step = printAlarmStep(new Map(), feedOf([kot]), "dev-a", T0, false);
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.dismiss, ["k"], "left the feed (printing, or printed): the notice goes at once");
  step = printAlarmStep(step.memory, feedOf([kot]), "dev-a", T0 + 40_000, false);
  assert.equal(step.ring, false, "back after a moment (a lease that refused): no second ring");
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 60_000, false);
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 60_000 + PRINT_ALARM_FORGET_MS + 1, false);
  assert.equal(step.memory.has("k"), false, "forgotten a minute after it left");
});

test("the 1E final review: a slip back from a moment's lease (a refusal) gets its notice back, quietly; a slip staff acted on does not", () => {
  const kot = row({ id: "k", originDeviceId: "dev-a" });
  let step = printAlarmStep(new Map(), feedOf([kot]), "dev-a", T0, false);
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.dismiss, ["k"], "leased for a moment: the notice goes");
  step = printAlarmStep(step.memory, feedOf([kot]), "dev-a", T0 + 40_000, false);
  assert.deepEqual(step.show.map((r) => r.id), ["k"], "still not printed: its notice comes back (staff must not read the gap as printed)");
  assert.equal(step.ring, false, "no second ring for the same wait");
  step = printAlarmStep(step.memory, feedOf([kot]), "dev-a", T0 + 60_000, false);
  assert.deepEqual(step.show, [], "shown once; not re-shown every pulse");
  assert.equal(step.ring, false, "and still no ring");
  const failed = row({ id: "f", status: "failed", originDeviceId: "dev-a" });
  step = printAlarmStep(new Map(), feedOf([failed]), "dev-a", T0, false);
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 20_000, false);
  step = printAlarmStep(step.memory, feedOf([row({ id: "f", originDeviceId: "dev-a", approved: true })]), "dev-a", T0 + 40_000, false);
  assert.deepEqual(step.show, [], "Retry from another device while it was away: staff acted, no notice");
  step = printAlarmStep(step.memory, feedOf([row({ id: "f", originDeviceId: "dev-a", approved: true })]), "dev-a", T0 + 60_000, false);
  assert.deepEqual(step.show, [], "and it stays quiet while it waits for its printer");
});

test("a page that opens while slips wait shows one summary, not one notice per slip (N-5)", () => {
  const rows = [row({ id: "a", originDeviceId: "dev-a" }), row({ id: "b", status: "failed", targetDeviceId: "dev-a" }), row({ id: "c", originDeviceId: "dev-b" })];
  const first = printAlarmStep(new Map(), feedOf(rows), "dev-a", T0, true);
  assert.equal(first.summary, 2, "the two this device should hear about");
  assert.deepEqual(first.show, [], "no notice per slip");
  assert.equal(first.ring, false, "the summary rings once (the hook), not per slip");
  assert.equal(first.wanted, 2);
  const next = printAlarmStep(first.memory, feedOf([...rows, row({ id: "d", originDeviceId: "dev-a" })]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(next.show.map((r) => r.id), ["d"], "a new slip after that rings as usual");
  assert.equal(next.summary, 0);
  assert.equal(printAlarmStep(next.memory, feedOf([]), "dev-a", T0 + 40_000, false).wanted, 0, "nothing waits: the summary can go");
});

test("the Phase 1 final gate (M6): Print now on a stale slip is staff acting on it: its notice goes quietly, like Retry and Print again", () => {
  const stale = row({ id: "s", createdAt: ago(31 * 60_000), originDeviceId: "dev-a" });
  let step = printAlarmStep(new Map(), feedOf([stale]), "dev-a", T0, false);
  assert.deepEqual(step.show.map((r) => r.id), ["s"], "it waited: its notice shows");
  step = printAlarmStep(step.memory, feedOf([{ ...stale, approved: true }]), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.dismiss, ["s"], "Print now was tapped: its notice goes");
  assert.equal(step.ring, false, "quietly");
  step = printAlarmStep(step.memory, feedOf([]), "dev-a", T0 + 40_000, false);
  step = printAlarmStep(step.memory, feedOf([{ ...stale, approved: true }]), "dev-a", T0 + 60_000, false);
  assert.deepEqual(step.show, [], "a moment's lease after the tap brings no notice back: staff acted on it");
  step = printAlarmStep(step.memory, feedOf([{ ...stale, approved: true, status: "failed" }]), "dev-a", T0 + 80_000, false);
  assert.equal(step.ring, true, "it got worse after the tap: it rings again");
});

test("the Phase 1 final gate (M4): the summary counts the slips it stands for as they print, and goes with the last of them", () => {
  const rows = [row({ id: "a", originDeviceId: "dev-a" }), row({ id: "b", originDeviceId: "dev-a" }), row({ id: "c", originDeviceId: "dev-a" })];
  let step = printAlarmStep(new Map(), feedOf(rows), "dev-a", T0, true);
  assert.equal(step.summary, 3, "three already waited when the page opened");
  assert.equal(step.summaryWaiting, 3, "and the summary stands for three");
  const d = row({ id: "d", originDeviceId: "dev-a" });
  step = printAlarmStep(step.memory, feedOf([rows[2] ?? d, d]), "dev-a", T0 + 20_000, false);
  assert.equal(step.summaryWaiting, 1, "two printed: the summary says one now");
  assert.deepEqual(step.show.map((r) => r.id), ["d"], "a new slip has its own notice, outside the summary");
  step = printAlarmStep(step.memory, feedOf([{ ...(rows[2] ?? d), status: "failed" }, d]), "dev-a", T0 + 40_000, false);
  assert.equal(step.ring, true, "the last one got worse: it rings");
  assert.deepEqual(step.show.map((r) => r.id), ["c"], "with its own notice");
  assert.equal(step.summaryWaiting, 0, "so the summary stands for nothing now and goes, though d still waits under its own notice");
});

test("with the newest 20 rows read, a slip older than the page that is cut off is still waiting: kept, notice and all (N-2)", () => {
  const oldOne = row({ id: "old", createdAt: ago(10 * 60_000), originDeviceId: "dev-a" });
  let step = printAlarmStep(new Map(), feedOf([oldOne]), "dev-a", T0, false);
  const page = Array.from({ length: 20 }, (_, i) => row({ id: `n${i}`, createdAt: ago(5 * 60_000 - i * 1_000), originDeviceId: "dev-b" }));
  step = printAlarmStep(step.memory, feedOf(page, true), "dev-a", T0 + 20_000, false);
  assert.deepEqual(step.dismiss, [], "cut off, not gone: its notice stays");
  assert.equal(step.memory.has("old"), true, "and it is remembered (no second ring when the backlog shrinks)");
  step = printAlarmStep(step.memory, feedOf([oldOne]), "dev-a", T0 + 40_000, false);
  assert.equal(step.ring, false, "back on the page: no second ring");
  step = printAlarmStep(step.memory, feedOf(page, false), "dev-a", T0 + 60_000, false);
  assert.deepEqual(step.dismiss, ["old"], "the feed is whole and it is not in it: it is gone");
});

test("a tap's answer in plain words: done, already handled, or it prints by itself when the printer is ready", () => {
  assert.equal(printRetryNotice({ applied: true, status: "queued" }), null, "done: the row leaves on the next tick");
  assert.equal(printRetryNotice({ applied: false, status: "queued", reason: "wrong-status" }), "It prints by itself as soon as the printer is ready.");
  assert.equal(printRetryNotice({ applied: false, status: "printed", reason: "wrong-status" }), "Already handled.");
  assert.equal(printRetryNotice({ applied: false, status: null, reason: "not-found" }), "Already handled.");
  // Session 2C (the 2B gate's ruling R2): never guessed onto another printer.
  assert.equal(printRetryNotice({ applied: false, status: "failed", reason: "printer-gone" }), "No printer takes this slip now (removed, switched off, or none set up). Print it again from its order.");
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
  for (const action of ["retry(id)", 'confirm(id, "reprint")', 'confirm(id, "printed")', "dismiss(id)"]) assert.ok(card.includes(action), `the card offers ${action}`);
  const actions = src("apps/cafe/hooks/use-print-job-actions.ts");
  assert.match(actions, /kickPrintAgent\(\);/, "a tap wakes this device's agent at once (it may be the one that prints)");
  assert.match(actions, /qc\.invalidateQueries\(\{ queryKey: POS_PULSE_KEYS\.all \}\)/, "the panel refreshes after a tap (one request per tap, never a poll)");
});

// Session 1D final review I-2: a tapped row was released only when it left the feed, so a row that stays
// in it (a Retry while its printer is off, a second failure before the next pulse, a network error, Print
// now on a slip that waits for its printer) stayed disabled, Clear included. The server's CAS makes a
// repeat tap a no-op, so the row comes back as soon as its action answers.
// The 1D review gate changed this pin deliberately: TanStack's per-call mutate() callbacks fire only for
// the latest call of one useMutation, so a second row tapped before the first answered left the first one
// disabled. Each tap now gets its own promise.
test("PIN: a tapped row is enabled again once ITS action answers, whatever the answer, even when another row was tapped meanwhile", () => {
  const card = src("apps/cafe/components/print/WaitingSlipsCard.tsx");
  assert.match(card, /void run\(\)\.finally\(\(\) => release\(id\)\);/, "every tap releases its own row when its own request settles");
  assert.ok(!/\.mutate\(/.test(card), "no per-call mutate() callbacks (only the latest call's would fire)");
  const actions = src("apps/cafe/hooks/use-print-job-actions.ts");
  assert.match(actions, /retry: \(id: string\): Promise<void> => retry\.mutateAsync\(id\)\.then\(done, done\),/, "a promise per tap");
  assert.match(actions, /confirm: \(id: string, decision: PrintJobDecision\): Promise<void> => confirm\.mutateAsync\(\{ id, decision \}\)\.then\(done, done\),/);
  assert.match(actions, /dismiss: \(id: string\): Promise<void> => dismissJob\.mutateAsync\(id\)\.then\(done, done\)\.finally\(settled\),/, "Clear refreshes the panel and wakes the agent when it answers");
  assert.match(actions, /toast\.info\(notice, \{ duration: NOTICE_MS \}\)/, "a tap's answer stays long enough to read (the 1D E2E)");
  for (const verb of ["Clear", "Print again", "It printed"]) assert.ok(card.includes(`aria-label={\`${verb} \${label}\`}`), `${verb} names its slip (M-5)`);
  assert.ok(card.includes("aria-label={`${verb} ${label}`}"), "Print now / Retry name their slip (M-5)");
});

test("PIN (the Phase 1 final gate, the alert sound): the page tries the sound once on mount, then on the first touch", () => {
  // A printing device that restarted and was left untouched showed its notices but never rang: the page only ever
  // tried the sound from a touch. Where the page may play sound without one (the POS app: Android's WebView lets a
  // page's own AudioContext start untouched, measured on WebView 109 with today's APK; the Windows app) one try on
  // mount is enough; in a browser tab it stays locked until the first touch, as before.
  const provider = src("apps/cafe/components/layout/PosPulseProvider.tsx");
  assert.match(provider, /useEffect\(\(\) => \{\s*unlock\(\);\s*const handler = \(\) => unlock\(\);/, "one try on mount, before the gesture listener");
  assert.match(provider, /window\.addEventListener\("pointerdown", handler, \{ once: true, capture: true \}\);/, "the first touch still unlocks it");
  const sound = src("apps/cafe/lib/alert-sound.ts");
  assert.equal((sound.match(/\.resume\(\)/g) ?? []).length, 1, "resume() still only inside unlockAlertSound");
});

test("PIN: the alarm rides the pulse already polled (no request), and only the printing lane's drain mounts it", () => {
  const alarm = src("apps/cafe/hooks/use-print-slip-alarm.ts");
  assert.ok(!/apiGet|apiSend|useQuery\(|refetchInterval|setInterval/.test(alarm), "no request and no poll of its own");
  assert.match(alarm, /qc\.getQueryCache\(\)\.subscribe\(/, "it hears each pulse answer");
  assert.match(
    alarm,
    /if \(\(step\.ring \|\| step\.summary > 0\) && readDevicePrefs\(\)\.alertSound && isAlertSoundUnlocked\(\)\) playAlertPing\(\);/,
    "one ring per pulse at most, and the cafe's sound setting decides",
  );
  assert.match(alarm, /const SHOW = \{ label: "Show", onClick: openPrinterPanel \};/, "the notice opens the panel itself (it covers the top bar on a phone)");
  assert.match(alarm, /const SHOW_STYLE = \{ minHeight: 44, minWidth: 44 \};/, "a 44 px Show button (1D gate M-5)");
  assert.match(alarm, /let page: \{ deviceId: string; memory: Map<string, PrintAlarmMemory>; seeded: boolean; summary: number \}/, "remembered per page, not per mount: a remount rings nothing twice");
  // The Phase 1 final gate (M4, deliberate change): the summary is re-worded as its slips print, and goes with the last.
  assert.match(alarm, /if \(step\.summaryWaiting !== page\.summary\) \{/, "the summary follows the count it stands for");
  assert.ok(!alarm.includes("if (step.wanted === 0) toast.dismiss(SUMMARY_ID);"), "not every waiting slip: a new one has its own notice");
  assert.match(alarm, /return \(\) => \{\s*unsubscribe\(\);\s*toast\.dismiss\(SUMMARY_ID\);/, "an unmount takes its notices down (M-1)");
  assert.match(src("apps/cafe/components/print/PrinterStatusButton.tsx"), /useEffect\(\(\) => onOpenPrinterPanel\(\(\) => setOpen\(true\)\), \[\]\);/, "the printer button opens its sheet when asked");
  assert.match(src("apps/cafe/components/print/PrintHostDrain.tsx"), /usePrintSlipAlarm\(deviceId\);/, "every device with an identity");
});

// Session 2C (printers mode): the panel names a waiting slip's printer from this device's printer list.
test("2C: a waiting slip's printer by name; none for simple mode, a printer no longer listed, or no printer at all", () => {
  const printers = [{ id: "p-bar", name: "Bar printer" }];
  assert.equal(printerNameOf(printers, "p-bar"), "Bar printer");
  assert.equal(printerNameOf(printers, undefined), null, "simple mode");
  assert.equal(printerNameOf(printers, "p-gone"), null, "removed since");
  assert.equal(printerNameOf(printers, "none"), null, "no printer took it (its reason says so)");
});
