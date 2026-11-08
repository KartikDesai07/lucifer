import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { QueryClient, hashKey } from "@tanstack/query-core";

import type { PrintAckData, PrintAttentionRow } from "@pos/shared/print-agent-wire";
import type { PosPulseData } from "@pos/shared/self-order-alert";
import { REFETCH_INTERVALS } from "@pos/shared/query";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";
import { stripComments } from "@/lib/source-pin-utils";
import type { PrintAgentAckBody } from "@/lib/print-agent-types";
import { JOB_MAYBE_TOAST, JOB_NOT_CONNECTED_TOAST, jobPrintToastOf } from "@/lib/print-job-toast";
import { dropPrintedFromPulse } from "@/lib/print-pulse-edit";
import { PRINT_HOST_EOD_TIMEOUT_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { LANE_PRINT_FAILED_MESSAGE, NO_PRINTER_MESSAGE } from "@/lib/printer/lane-print";
import { RASTER_FAILED_MESSAGE } from "@/lib/printer/raster";
import { NATIVE_BLUETOOTH_OFF_MESSAGE } from "@/lib/printer/transport-native";
import {
  PRINTER_ELSEWHERE_MESSAGE,
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_TOO_LARGE_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
} from "@/lib/printer/web-printer-types";

// PX-2 Task 7 (spec §6.9 B4, B7; §14 R4; §15 F-I1). B7: a failed write of a slip printed for a print JOB says the job's
// truth (it waits and prints by itself, or check the paper), never the lane's "then print the slip again"; a slip with
// no job keeps today's words, and the lane's own sentences stay byte-identical (they are also a job's lastError). B4: a
// slip this device just printed leaves the cached Not printed list at once, and that manual cache write never kicks
// the page agent into a trailing lease.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

test("the three mappings, in the spec's exact words", () => {
  assert.equal(JOB_NOT_CONNECTED_TOAST, "The printer is not connected. The slip waits and prints by itself once it is back: tap the printer icon to reconnect.", "B7: not connected");
  assert.equal(JOB_MAYBE_TOAST, "The printer stopped answering. Check the paper: the printer icon shows what still waits.", "B7 (R4): may be on paper");
  assert.equal(jobPrintToastOf(PRINTER_NOT_CONNECTED_MESSAGE), JOB_NOT_CONNECTED_TOAST, "nothing was sent: the job waits and prints by itself");
  assert.equal(jobPrintToastOf(PRINTER_WRITE_FAILED_MESSAGE), JOB_MAYBE_TOAST, "a write that may have reached paper");
  assert.equal(jobPrintToastOf(PRINT_HOST_PRINT_FAILED_MESSAGE), JOB_MAYBE_TOAST, "the bridge's own failure (the watchdog) may be on paper");
  assert.equal(jobPrintToastOf(LANE_PRINT_FAILED_MESSAGE), JOB_MAYBE_TOAST, "any sentence read as 'maybe'");
  assert.equal(jobPrintToastOf("Something odd happened"), JOB_MAYBE_TOAST, "an unknown error is 'maybe', the safe direction");
});

test("a direct slip keeps its words: any other lane message is unchanged", () => {
  for (const message of [NATIVE_BLUETOOTH_OFF_MESSAGE, PRINTER_ELSEWHERE_MESSAGE, NO_PRINTER_MESSAGE, PRINTER_TOO_LARGE_MESSAGE, RASTER_FAILED_MESSAGE, PRINT_HOST_EOD_TIMEOUT_MESSAGE]) {
    assert.equal(jobPrintToastOf(message), message, `a refusal that says what to fix keeps its words: ${message}`);
  }
});

test("the lane constants are byte-identical", () => {
  assert.equal(PRINTER_NOT_CONNECTED_MESSAGE, "The printer is not connected. Tap the printer icon and reconnect it, then print the slip again.", "today's sentence (also a job's lastError)");
  assert.equal(PRINTER_WRITE_FAILED_MESSAGE, "The printer stopped answering. Check the paper first: part or all of this slip may already have printed. Reconnect, then reprint only if needed.", "today's sentence");
  assert.equal(PRINT_HOST_PRINT_FAILED_MESSAGE, "The print host could not open that slip — reprint it from Orders.", "today's sentence");
});

const ROWS: PrintAttentionRow[] = [
  { id: "j1", kind: "kot", label: "KOT 1", status: "queued", labels: [], createdAt: "2026-11-05T12:00:00.000Z" },
  { id: "j2", kind: "kot", label: "KOT 2", status: "queued", labels: [], createdAt: "2026-11-05T12:00:10.000Z" },
];
const PRINTED = { deviceId: "dev-a", epoch: 1, outcome: "printed" as const };
const answerOf = (over: Partial<PrintAckData> = {}): PrintAckData => ({ applied: true, status: "printed", nextAttemptAt: null, ...over });

const PULSE_AT = 1_762_000_000_000;
const NOW = PULSE_AT + 5_000; // a fresh answer, 5 s old

function fakeClient(data: Partial<PosPulseData>, state: { fetchStatus?: string; dataUpdatedAt?: number } = {}) {
  const writes: { key: unknown; data: unknown; options: unknown }[] = [];
  const getQueryState = () => ({ data, dataUpdatedAt: PULSE_AT, fetchStatus: "idle", ...state });
  const setQueryData = (key: unknown, update: unknown, options: unknown): undefined => {
    writes.push({ key, data: typeof update === "function" ? (update as (old: unknown) => unknown)(data) : update, options });
    return undefined;
  };
  return { qc: { getQueryState, setQueryData } as unknown as Pick<QueryClient, "getQueryState" | "setQueryData">, writes };
}

test("dropPrintedFromPulse: a printed applied answer removes the row; a failed or not-applied one leaves the cache untouched", () => {
  const printed = fakeClient({ printAttention: ROWS });
  const answer = answerOf();
  assert.equal(dropPrintedFromPulse(printed.qc, "j1", PRINTED, answer, NOW), answer, "the answer goes on to the agent unchanged");
  assert.equal(printed.writes.length, 1, "one cache write, no request");
  assert.deepEqual(printed.writes[0]?.key, POS_PULSE_KEYS.all, "the pulse the provider already polls");
  assert.deepEqual((printed.writes[0]?.data as PosPulseData).printAttention?.map((r) => r.id), ["j2"], "the printed slip leaves the list at once");
  assert.deepEqual(printed.writes[0]?.options, { updatedAt: PULSE_AT }, "the pulse keeps its own time: an edit is no answer");
  const cases: [string, PrintAgentAckBody, PrintAckData, string][] = [
    ["a failed ack", { ...PRINTED, outcome: "failed", sent: "maybe" }, answerOf({ status: "queued" }), "j1"],
    ["a printed ack the server did not apply", PRINTED, answerOf({ applied: false }), "j1"],
    ["an applied ack that left it anything but printed", PRINTED, answerOf({ status: "dismissed" }), "j1"],
    ["a printed slip the list never showed (most of them)", PRINTED, answerOf(), "j9"],
  ];
  for (const [name, body, other, id] of cases) {
    const untouched = fakeClient({ printAttention: ROWS });
    assert.equal(dropPrintedFromPulse(untouched.qc, id, body, other, NOW), other, `${name}: the answer goes on`);
    assert.deepEqual(untouched.writes, [], `${name}: the cache is untouched`);
  }
});

// Fix round 1 (I-1, Ruling S; m-1): every cache write restarts the pulse's interval timer, and the host beat rides each
// real pulse answer. So the edit lands only on a fresh answer (under one lively interval old) with no pulse in flight:
// a long drain can never hold the host's pulse (and beat) off past PRINT_HOST_OFFLINE_MS, and an answer read before
// the ack can never write the printed slip back over the edit.
test("dropPrintedFromPulse: an answer 20 s or older, or a pulse in flight, leaves the cache untouched; fresh and idle drops the row", () => {
  const old = fakeClient({ printAttention: ROWS });
  dropPrintedFromPulse(old.qc, "j1", PRINTED, answerOf(), PULSE_AT + REFETCH_INTERVALS.POS_PULSE);
  assert.deepEqual(old.writes, [], "an answer 20 s old: the row leaves at the next answer (no timer restart)");
  const stale = fakeClient({ printAttention: ROWS });
  dropPrintedFromPulse(stale.qc, "j1", PRINTED, answerOf(), PULSE_AT + 10 * 60_000);
  assert.deepEqual(stale.writes, [], "far older: untouched too");
  const inFlight = fakeClient({ printAttention: ROWS }, { fetchStatus: "fetching" });
  dropPrintedFromPulse(inFlight.qc, "j1", PRINTED, answerOf(), NOW);
  assert.deepEqual(inFlight.writes, [], "a pulse in flight: its answer, read before the ack, would write the slip back");
  const fresh = fakeClient({ printAttention: ROWS });
  dropPrintedFromPulse(fresh.qc, "j1", PRINTED, answerOf(), PULSE_AT + REFETCH_INTERVALS.POS_PULSE - 1);
  assert.deepEqual(fresh.writes.map((w) => (w.data as PosPulseData).printAttention?.map((r) => r.id)), [["j2"]], "fresh, idle and listed: the row leaves at once");
  assert.deepEqual(fresh.writes[0]?.options, { updatedAt: PULSE_AT }, "anchored to the last real answer");
});

test("dropPrintedFromPulse writes the cache manually: a listener can tell it from a pulse answer (F-I1)", () => {
  const qc = new QueryClient();
  qc.setQueryData(POS_PULSE_KEYS.all, { printAttention: ROWS }, { updatedAt: PULSE_AT });
  const heard: { manual: boolean; ids: string[] }[] = [];
  const pulseHash = hashKey(POS_PULSE_KEYS.all);
  const off = qc.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || event.query.queryHash !== pulseHash) return;
    heard.push({ manual: event.action.manual === true, ids: ((event.query.state.data as PosPulseData).printAttention ?? []).map((r) => r.id) });
  });
  dropPrintedFromPulse(qc, "j2", PRINTED, answerOf(), NOW);
  dropPrintedFromPulse(qc, "j9", PRINTED, answerOf(), NOW);
  off();
  assert.deepEqual(heard, [{ manual: true, ids: ["j1"] }], "one success event the alarm hears (its notice goes) and the agent's listener skips");
  assert.equal(qc.getQueryState(POS_PULSE_KEYS.all)?.dataUpdatedAt, PULSE_AT, "the pulse's own time is kept (the POS app's hidden tick reads it)");
});

test("PIN: printAgentSlipOf sets jobId", () => {
  const slip = src("apps/cafe/lib/print-agent-slip.ts");
  assert.ok(slip.includes("const slip = { ...hostPrintSlipOf(job.payload, todayKey), jobId: job.id };"), "a slip printed for a job names its job");
  assert.ok(src("apps/cafe/lib/print-host-slips.ts").includes("jobId?: string;"), "an optional field on HostPrintSlip");
});

test("PIN: the bridge maps a job slip's toast", () => {
  const bridge = src("apps/cafe/hooks/use-print-host-bridge.ts");
  const settle = bridge.slice(bridge.indexOf("const settle = useCallback("), bridge.indexOf("const finish = useCallback("));
  assert.ok(settle.includes("toast.error(slipToastOf(failure, jobIdRef.current));"), "settle: slipToastOf = the job's words for a job's slip (jobPrintToastOf), today's for any other, then the Windows refusal's pointer (PX-3 X1)");
  const abandon = bridge.slice(bridge.indexOf("const abandon = useCallback("), bridge.indexOf("[lateGuard, settle]"));
  assert.ok(abandon.includes("toast.error(slipToastOf(PRINT_HOST_PRINT_FAILED_MESSAGE, jobIdRef.current));"), "the watchdog likewise");
  assert.ok(bridge.includes('jobIdRef.current = current?.kind === "slip" ? current.slip.jobId : undefined;'), "the job of the slip on the paper now (a test slip has none)");
  assert.ok(bridge.indexOf("jobIdRef.current = current") < bridge.indexOf("if (!current || dispatchedRef.current || !surfacesMounted) return;"), "kept before the dispatch effect runs, so it is never a slip behind");
  assert.ok(bridge.includes("waiter?.reject(new Error(failure));"), "a test slip's own words are untouched");
});

test("PIN: the agent drops a printed slip from the cached feed", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  // P2 N4 (deliberate move, R53): the ack dep is wrapped in trackPrintBusy(...), and the print dep that ends the slice
  // is now `print: (job) =>`; the slice must end there (a missing end would widen it to the whole file).
  const ackAt = agent.indexOf("ack: (id, body) =>");
  const ackEnd = agent.indexOf("print: (job) =>", ackAt);
  assert.ok(ackAt >= 0 && ackEnd > ackAt, "the ack dep and the print dep after it are both found");
  const ack = agent.slice(ackAt, ackEnd);
  assert.ok(ack.includes(".then((answer) => dropPrintedFromPulse(qc, id, body, answer))),"), "inside the ack dep: every answer passes through it, no request");
  assert.ok(src("apps/cafe/lib/print-pulse-edit.ts").includes('if (body.outcome === "printed" && answer.applied && answer.status === "printed")'), "only an applied printed ack edits the cache");
});

test("PIN: the agent's pulse listener ignores manual cache writes (F-I1); the alarm's still hears them (B4)", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  const listener = agent.slice(agent.indexOf("const off = qc.getQueryCache().subscribe((event) => {"), agent.indexOf("setPulsePrintDevice(null);"));
  assert.ok(listener.includes("if (event.action.manual === true) return;"), "a cache edit (a printed slip, a Clear) never kicks a trailing lease");
  assert.ok(listener.indexOf("if (event.action.manual === true) return;") < listener.indexOf("agent.kick();"), "before any kick");
  const alarm = src("apps/cafe/hooks/use-print-slip-alarm.ts");
  assert.ok(alarm.includes("qc.getQueryCache().subscribe((event) => {"), "landmark: the alarm's own cache listener");
  assert.ok(!alarm.includes("manual"), "the alarm hears a manual write: a slip that leaves the list takes its notice with it");
});

test("PIN: the button reports the panel open", () => {
  const button = src("apps/cafe/components/print/PrinterStatusButton.tsx");
  assert.ok(button.includes("reportPrinterPanelOpen(open)"), "the button reports its sheet's state");
  const panelOpen = src("apps/cafe/lib/printer-panel-open.ts");
  const report = panelOpen.slice(panelOpen.indexOf("export function reportPrinterPanelOpen("));
  assert.ok(report.includes("setPrinterPanelOpen(open);") && report.includes("return () => setPrinterPanelOpen(false);"), "through setPrinterPanelOpen, cleared on a close or an unmount");
});
