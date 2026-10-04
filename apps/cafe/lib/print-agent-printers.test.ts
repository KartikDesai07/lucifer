import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { PrinterConfig } from "@pos/shared/print-printers";
import { stripComments } from "@/lib/source-pin-utils";
import { PRINTER_NOT_LOCAL_MESSAGE, agentPrintersOf, jobsForMeLeasable, printJobCopies, printerIsLocal, printerListLooksStale } from "@/lib/print-agent-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import { PRINTER_NOT_CONNECTED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";

// Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which of them it prints
// on its one local printer (until Session 2E). Pure; the agent hook reads it.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const SLIPS = { bill: true, kotStations: [], kotAll: false, notices: false, eod: false };

function printer(id: string, connection: PrinterConfig["connection"], over: Partial<PrinterConfig> = {}): PrinterConfig {
  return { id, name: id, connection, order: 0, paper: 80, slips: SLIPS, copies: { kot: 1, bill: 1 }, enabled: true, ...over };
}

const NATIVE_TCP: DevicePrinter = { kind: "native", name: "LAN", paper: "80mm", printerId: "tcp:192.168.1.60:9100", transport: "tcp" };
// The ids the Android app reports (Kotlin PrinterIds, stored verbatim by nativeRecordOf): "<transport>:<id>".
const NATIVE_BT: DevicePrinter = { kind: "native", name: "BT", paper: "58mm", printerId: "bt-classic:00:11:22:33:44:55", transport: "bt-classic" };
const NATIVE_BLE: DevicePrinter = { kind: "native", name: "BLE", paper: "58mm", printerId: "ble:00:11:22:33:44:55", transport: "ble" };
const NATIVE_USB: DevicePrinter = { kind: "native", name: "USB", paper: "80mm", printerId: "usb:0416:5011", transport: "usb" };
const WEB_BLE: DevicePrinter = { kind: "ble", name: "BLE", paper: "58mm", deviceId: "ble-1", serviceUuid: "s", characteristicUuid: "c" };
const WEB_SERIAL: DevicePrinter = { kind: "serial", name: "USB", paper: "80mm" };

test("printerIsLocal: a printer is printed here only when it IS this device's printer", () => {
  const lan = printer("lan", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  assert.equal(printerIsLocal(lan, NATIVE_TCP, false), true, "the app's selected network printer, same host and port");
  assert.equal(printerIsLocal({ ...lan, connection: { kind: "lan", host: "192.168.1.60", port: 9101 } }, NATIVE_TCP, false), false, "another port");
  assert.equal(printerIsLocal(lan, NATIVE_BT, false), false, "a Bluetooth printer is not that LAN printer");
  const bt = printer("bt", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "00:11:22:33:44:55" });
  assert.equal(printerIsLocal(bt, NATIVE_BT, false), true, "the paired printer by its address");
  assert.equal(printerIsLocal({ ...bt, connection: { ...bt.connection, address: "AA:BB" } as PrinterConfig["connection"] }, NATIVE_BT, false), false, "another paired printer");
  // Session 2C's final review (I-1): the app names its printer "<transport>:<id>"; the setup's address is the bare
  // id (§6.3), or the app's whole id when the setup stored what the app reported.
  assert.equal(printerIsLocal(printer("bt2", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "bt-classic:00:11:22:33:44:55" }), NATIVE_BT, false), true, "the app's whole id");
  const ble = printer("ble-n", { kind: "device", deviceId: "dev-a", transport: "ble", address: "00:11:22:33:44:55" });
  assert.equal(printerIsLocal(ble, NATIVE_BLE, false), true, "a BLE printer by its address");
  assert.equal(printerIsLocal(ble, NATIVE_BT, false), false, "the same address over another transport is another printer");
  assert.equal(printerIsLocal(printer("usb", { kind: "device", deviceId: "dev-a", transport: "usb", address: "0416:5011" }), NATIVE_USB, false), true, "a USB printer by its vendor:product id");
  assert.equal(printerIsLocal(printer("usb2", { kind: "device", deviceId: "dev-a", transport: "usb", address: "0416:5012" }), NATIVE_USB, false), false, "another USB model");
  assert.equal(printerIsLocal(printer("ble", { kind: "device", deviceId: "dev-a", transport: "web-bluetooth", address: "ble-1" }), WEB_BLE, false), true);
  assert.equal(printerIsLocal(printer("ser", { kind: "device", deviceId: "dev-a", transport: "web-serial", address: "usb" }), WEB_SERIAL, false), true, "a tab drives one serial printer");
  const win = printer("win", { kind: "device", deviceId: "dev-a", transport: "windows", address: "EPSON TM-T82" });
  assert.equal(printerIsLocal(win, null, true), true, "the Windows app prints a Windows printer");
  assert.equal(printerIsLocal(win, null, false), false, "a browser does not");
  assert.equal(printerIsLocal(bt, null, false), false, "no printer saved here");
});

test("agentPrintersOf: printers mode, whether this device writes one, and the ones it prints here", () => {
  const counter = printer("counter", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a" });
  const kitchen = printer("kitchen", { kind: "lan", host: "192.168.1.61", port: 9100 }, { primaryDeviceId: "dev-k" });
  const bar = printer("bar", { kind: "device", deviceId: "dev-a", transport: "bt-classic", address: "AA:BB" });
  const off = printer("off", { kind: "lan", host: "192.168.1.60", port: 9100 }, { primaryDeviceId: "dev-a", enabled: false });
  assert.deepEqual(agentPrintersOf([counter, kitchen, bar, off], "dev-a", NATIVE_TCP, false), { printersMode: true, isWriter: true, localIds: ["counter"] }, "it writes the counter and the bar; only the counter is its printer");
  assert.deepEqual(agentPrintersOf([counter, kitchen], "dev-p", NATIVE_TCP, false), { printersMode: true, isWriter: false, localIds: [] }, "an ordering phone writes nothing");
  assert.deepEqual(agentPrintersOf([], "dev-a", NATIVE_TCP, false), { printersMode: false, isWriter: false, localIds: [] }, "simple mode");
  assert.deepEqual(agentPrintersOf([counter], "", NATIVE_TCP, false), { printersMode: true, isWriter: false, localIds: [] }, "no device identity");
});

// The 2C gate's review (I-2) and its emulator run: a list goes stale both ways when a print-setup frame is missed.
// A device made a writer hears of its printer's jobs; a writer whose printer was removed or moved hears it from the
// wake, or it would poll the wake all day for nothing. A host in simple mode is never a writer: it never re-reads.
test("printerListLooksStale: a printer job it does not print on, or a writer the setup no longer names", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  const jobs = (printerIds?: string[]) => ({ count: 1, oldestCreatedAt: null, ...(printerIds === undefined ? {} : { printerIds }) });
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, jobsForMe: jobs([a]) }), false, "its own printer's job");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, jobsForMe: jobs([a, b]) }), true, "a printer it does not know of");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, jobsForMe: jobs([b]) }), true, "made a writer while the frame was missed");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, jobsForMe: jobs() }), false, "its own simple-mode line");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, writesPrinters: false }), true, "its printer removed or moved");
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true, writesPrinters: true }), false);
  assert.equal(printerListLooksStale({ ready: [a], isWriter: true }), false, "an older server says nothing");
  assert.equal(printerListLooksStale({ ready: [], isWriter: false, writesPrinters: false }), false, "the host in simple mode");
});

// Session 2C's final review (I-2): jobs-for-me counts every job aimed at the device, including ones on a printer it
// does not print on (a second printer it writes, before Session 2E; a printer whose address is not its own). A kick
// on those leased nothing, on every pulse and every wake, with the wake's fast cadence re-armed: a loop.
test("jobsForMeLeasable: only jobs this agent can lease kick it: its own line, or a printer it prints here", () => {
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.equal(jobsForMeLeasable(undefined, [a]), false, "nothing counted");
  assert.equal(jobsForMeLeasable({ count: 0, oldestCreatedAt: null }, [a]), false, "an empty count");
  assert.equal(jobsForMeLeasable({ count: 2, oldestCreatedAt: null }, []), true, "its own simple-mode line (or an older server)");
  assert.equal(jobsForMeLeasable({ count: 1, oldestCreatedAt: null, printerIds: [a] }, [a]), true, "a printer it prints here");
  assert.equal(jobsForMeLeasable({ count: 3, oldestCreatedAt: null, printerIds: [b, a] }, [a]), true, "one of them is");
  assert.equal(jobsForMeLeasable({ count: 1, oldestCreatedAt: null, printerIds: [b] }, [a]), false, "only a printer it does not print on: no kick");
  assert.equal(jobsForMeLeasable({ count: 2, oldestCreatedAt: null, printerIds: [b], ownLine: true }, [a]), true, "beside a job on its own line");
});

test("PIN (2C final review, I-2): the pulse and the wake kick the agent only on jobs it can lease", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /if \(jobsForMeLeasable\(data\?\.printJobsForMe, readyRef\.current\)\) agent\.kick\(\);/, "the pulse");
  assert.match(agent, /leasable: \(jobs\) => jobsForMeLeasable\(jobs, readyRef\.current\),/, "the wake");
  assert.ok(agent.includes("noteJobsForMe(data?.printJobsForMe);"), "a stale list is still read again from the pulse");
});

test("PIN (2C): the page reads the printers on mount, on a print-setup frame and on focus at most every 30 min; every agent and the drain use it", () => {
  const hook = src("apps/cafe/hooks/use-agent-printers.ts");
  assert.match(hook, /queryFn: \(\) => apiGet<PrinterConfig\[\]>\("\/api\/printers"\),/);
  assert.match(hook, /staleTime: PRINTERS_STALE_MS,/);
  assert.match(hook, /refetchOnWindowFocus: true,/);
  assert.match(hook, /if \(kind === "print-setup"\) void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/);
  const drain = src("apps/cafe/components/print/PrintHostDrain.tsx");
  assert.match(drain, /const printers = useAgentPrinters\(deviceId, surfacesMounted && deviceId !== ""\);/);
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /lease: \(\) => apiSend<PrintLeaseData>\(LEASE_URL, "POST", \{ deviceId, tabId, \.\.\.printerIdsBody\(readyRef\.current\) \}\),/, "it leases its ready printers' lines too");
  assert.match(agent, /const offReady = setReadyPrintersSource\(\(\) => readyRef\.current\);/);
  // The 2C gate's review (I-2) and its emulator run: a list that looks stale is read again.
  assert.match(agent, /if \(!printerListLooksStale\(\{ ready: readyRef\.current, isWriter: writerRef\.current, jobsForMe: jobs, writesPrinters \}\)\) return;/);
  assert.match(agent, /void qc\.invalidateQueries\(\{ queryKey: PRINTERS_KEYS\.all \}\);/);
  assert.ok(agent.includes("noteJobsForMe(data?.printJobsForMe);") && agent.includes("noteJobsForMe(data.jobsForMe, data.writesPrinters);"), "from the pulse and the wake");
});

// The 2A gate's Important 1, the client half: the wake poll ran only on the host and spent against the constant
// 14,400 alone; in printers mode each writer polls, and every one spends against its share from the wake.
test("PIN (2C, the 2A gate's Important 1): the agent polls the wake by printAgentPollsWake and spends against its share", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /const pollsWake = printAgentPollsWake\(\{ hostConfigured: isHost, isHost, printersMode: printers\.printersMode, isWriter: printers\.isWriter \}\);/);
  assert.match(agent, /if \(agent === null \|\| !enabled \|\| !pollsWake\) return;/);
  assert.ok(!agent.includes("if (agent === null || !enabled || !isHost) return;"), "no longer the host alone");
  assert.match(agent, /capRef\.current = Math\.min\(PRINT_WAKE_DAILY_CAP, data\.agentDailyCap\);/, "the wake's answer lowers the cap");
  assert.match(agent, /bumpPrintWakeBudget\(mergePrintWakeBudget\(readPrintWakeBudget\(\), memory, dayKey\), dayKey, capRef\.current\)/, "the constant is no longer the only cap");
});

function printsWith(results: PrintAgentResult[]) {
  const calls: number[] = [];
  const once = async (): Promise<PrintAgentResult> => {
    calls.push(calls.length + 1);
    return results.shift() ?? { ok: true };
  };
  return { calls, once };
}

// Session 2C (spec §6.3 copies, plan decision 2): all copies of a slip are one job, written in its one lease.
test("printJobCopies: only this device's printer; every copy in one lease; a failure after the first copy may be on paper", async () => {
  const away = printsWith([]);
  const refused = await printJobCopies({ printerId: "p-bar" }, ["p-counter"], away.once);
  assert.deepEqual([away.calls.length, refused.ok ? null : printWriteOutcomeOf(refused.error)], [0, { sent: "no", permanent: false, message: PRINTER_NOT_LOCAL_MESSAGE }], "not this device's printer: refused, nothing sent, never counted");
  const simple = printsWith([]);
  assert.deepEqual([await printJobCopies({}, [], simple.once), simple.calls.length], [{ ok: true }, 1], "the device's own simple-mode line: one copy, as today");
  const two = printsWith([]);
  assert.deepEqual([await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], two.once), two.calls.length], [{ ok: true }, 2], "both copies, back to back");
  const firstFails = printsWith([{ ok: false, error: new Error(PRINTER_NOT_CONNECTED_MESSAGE) }]);
  const first = await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], firstFails.once);
  assert.deepEqual([firstFails.calls.length, first.ok ? null : printWriteOutcomeOf(first.error).sent], [1, "no"], "the first copy's refusal stands: nothing reached paper");
  const secondFails = printsWith([{ ok: true }, { ok: false, error: new PrintWriteError(PRINTER_WRITE_FAILED_MESSAGE, "no") }]);
  const second = await printJobCopies({ printerId: "p-counter", copies: 2 }, ["p-counter"], secondFails.once);
  assert.deepEqual(second.ok ? null : printWriteOutcomeOf(second.error), { sent: "maybe", permanent: false, message: PRINTER_WRITE_FAILED_MESSAGE }, "a copy is on paper already: maybe (its REPRINT repeats every copy)");
});

test("PIN (2C): the agent prints a leased job through printJobCopies on this device's printers; the station line reaches the paper", () => {
  const agent = src("apps/cafe/hooks/use-print-agent.ts");
  assert.match(agent, /const print = \(job: LeasedPrintJob\): Promise<PrintAgentResult> => printJobCopies\(job, readyRef\.current, \(\) => printOnce\(job\)\);/);
  const kot = src("apps/cafe/components/pos/KOTReceipt.tsx");
  const title = kot.indexOf("KITCHEN ORDER");
  const line = kot.indexOf("{stationLine && (");
  const number = kot.indexOf("#{roundNumber}");
  assert.ok(title > 0 && line > title && number > line, "under the title, above the number a cook calls out");
  assert.ok(src("apps/cafe/components/pos/PrintSources.tsx").includes("stationLine={kotStationLine}"), "PrintSources forwards it");
  assert.ok(src("apps/cafe/components/print/PrintHostPrintSources.tsx").includes("kotStationLine={slip.stationLine}"), "the agent's slip carries it");
});
