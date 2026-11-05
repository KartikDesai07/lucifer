// PX-3 final review (I1, I2, m1, m3): how a guided connect settles and how its Bluetooth list scans, pinned in the files
// that hold the code (comments stripped), each pin shown to bite on a mutation of the real file. The decisions themselves
// are unit-tested in lib/printer/connect-flow.test.ts and lib/printer/bluetooth-scan.test.ts.
import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { toast } from "sonner";

import { toastAddOutcome } from "@/components/print/connect-outcome";
import { CONNECT_ADDED, CONNECT_ADD_FAILED } from "@/lib/printer/connect-flow";
import { PRINTER_CONNECT_FAILED_MESSAGE } from "@/lib/printer/device-printer";
import { stripComments } from "@/lib/source-pin-utils";

const CAFE = fileURLToPath(new URL("../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n"));
const FLOW = "components/print/connect/ConnectFlow.tsx";
const OUTCOME = "components/print/connect-outcome.ts";
const LIST = "components/print/connect/ConnectList.tsx";
const SCAN = "components/print/connect/use-bluetooth-scan.ts";
const PRINTERS = "hooks/use-native-printer-list.ts";

// I1: a replace that ran and did not connect says the reason the link published; m1: one that ends after staff left the
// view says today's toast (X3: it finishes as today's would), by the mode.
function settleProblems(code: string): string[] {
  const p: string[] = [];
  if (!code.includes("(outcome): ConnectEvent => connectEndOf(state.mode, outcome, devicePrinter().getSnapshot().message),")) p.push("I1: the outcome reads the link's reason, by the mode");
  if (!/if \(live\.current\) send\(event\);\s*else void \(state\.mode === "add" \? toastAddOutcome\(run\) : toastConnectOutcome\(run\)\);/.test(code)) p.push("m1: a flow no longer on screen toasts today's words");
  if (!code.includes('import { toastAddOutcome, toastConnectOutcome } from "@/components/print/connect-outcome";')) p.push("m1: the words are connect-outcome.ts's");
  return p;
}
function outcomeProblems(code: string): string[] {
  const p: string[] = [];
  if (!code.includes('import { CONNECT_ADDED, CONNECT_ADD_FAILED } from "@/lib/printer/connect-flow";')) p.push("the add's words are today's constants");
  if (!/if \(outcome === "connected"\) toast\.success\(CONNECT_ADDED\);\s*else toast\.error\(CONNECT_ADD_FAILED\);/.test(code)) p.push("connected: added; anything else: added but not connected");
  if (/"(Printer added|The printer is added)/.test(code)) p.push("no copied sentence");
  return p;
}

test("I1 + m1: the flow's outcome says the printer's reason; a late one toasts today's words", () => {
  assert.deepEqual(settleProblems(src(FLOW)), [], "ConnectFlow.tsx");
  assert.deepEqual(outcomeProblems(src(OUTCOME)), [], "connect-outcome.ts");
  assert.equal(CONNECT_ADDED, "Printer added to this device.", "today's ADDED (OtherDevicePrinters before PX-3)");
  assert.equal(CONNECT_ADD_FAILED, "The printer is added, but not connected yet. Check it is on, then tap Reconnect.", "today's NOT_YET");
});

test("m1: a late add toasts today's words; never rejects", async () => {
  const said: string[] = [];
  const success = mock.method(toast, "success", (message: unknown) => {
    said.push(`ok: ${String(message)}`);
    return 1;
  });
  const error = mock.method(toast, "error", (message: unknown) => {
    said.push(`bad: ${String(message)}`);
    return 1;
  });
  try {
    await toastAddOutcome(Promise.resolve("connected"));
    await toastAddOutcome(Promise.resolve("failed"));
    await toastAddOutcome(Promise.reject(new Error("Allow Bluetooth for the POS app, then reconnect the printer.")));
    await toastAddOutcome(Promise.reject("boom"));
  } finally {
    success.mock.restore();
    error.mock.restore();
  }
  assert.deepEqual(said, [
    `ok: ${CONNECT_ADDED}`,
    `bad: ${CONNECT_ADD_FAILED}`,
    "bad: Allow Bluetooth for the POS app, then reconnect the printer.",
    `bad: ${PRINTER_CONNECT_FAILED_MESSAGE}`,
  ], "added; added but not connected; a thrown add in its words; else the connect-failed sentence");
});

// I2: one Allow at a time and a scan that did nothing changes nothing (bluetooth-scan.ts decides); the list view's Allow is
// always the Location ask.
function scanProblems(scan: string, printers: string, list: string): string[] {
  const p: string[] = [];
  if (!scan.includes("const [scanner] = useState(() => bluetoothScanOf(setShown));")) p.push("one scanner for the list's life");
  if (!scan.includes('scanner.allowLocation(scan, () => nativeRequest("permissions.request", { kind: "bluetooth" }))')) p.push("Allow asks Android through the scanner");
  if (/setScan(Error|Refusal)\(null\)/.test(scan)) p.push("nothing cleared before the scan answers");
  if (!/const scan = async \(\): Promise<unknown> => \{\s*if \(locked\) return undefined;/.test(printers)) p.push("a held list's scan does nothing, distinctly");
  if (!list.includes("onAllowLocation(): void;") || !list.includes("onAllow={onAllowLocation} />") || list.includes("onAllowLocation ??")) p.push("the view's Allow is the Location ask, required");
  return p;
}
// m3: the list scans by itself once more when Bluetooth turns usable, once nothing holds it.
function autoProblems(list: string): string[] {
  const p: string[] = [];
  const effect = list.slice(list.indexOf("const seen = useRef<NativeBluetoothState | null | undefined>(undefined);"), list.indexOf("<ConnectListView"));
  if (!effect.includes('if (transport !== "bluetooth" || list.printers === null || list.working || list.refreshing || list.scanning || seen.current === list.bluetooth) return;')) p.push("decided once the list answered and nothing holds it, per Bluetooth state");
  if (!/const auto = autoScanOf\(seen\.current, list\.bluetooth\);\s*seen\.current = list\.bluetooth;\s*if \(auto\) search\(\);/.test(effect)) p.push("autoScanOf decides, the state is remembered, then it scans");
  if (list.includes("scanned.current")) p.push("no once-only flag");
  return p;
}

test("I2 + m3: the scan's wiring", () => {
  assert.deepEqual(scanProblems(src(SCAN), src(PRINTERS), src(LIST)), [], "use-bluetooth-scan.ts, use-native-printer-list.ts, ConnectList.tsx");
  assert.deepEqual(autoProblems(src(LIST)), [], "ConnectList.tsx's FoundList");
});

test("every pin here bites: a mutation of the real file is noticed", () => {
  const [flow, outcome, scan, printers, list] = [FLOW, OUTCOME, SCAN, PRINTERS, LIST].map(src) as [string, string, string, string, string];
  const cases: [string, (code: string) => string[], string, string][] = [
    [flow, settleProblems, "devicePrinter().getSnapshot().message", "null"],
    [flow, settleProblems, "connectEndOf(state.mode,", 'connectEndOf("add",'],
    [flow, settleProblems, '\n        else void (state.mode === "add" ? toastAddOutcome(run) : toastConnectOutcome(run));', ""],
    [flow, settleProblems, '"add" ? toastAddOutcome(run) : toastConnectOutcome(run)', '"add" ? toastConnectOutcome(run) : toastAddOutcome(run)'],
    [outcome, outcomeProblems, "toast.success(CONNECT_ADDED)", 'toast.success("Printer added to this device.")'],
    [outcome, outcomeProblems, "else toast.error(CONNECT_ADD_FAILED);", "else if (outcome === \"failed\") toast.error(CONNECT_ADD_FAILED);"],
    [scan, (code) => scanProblems(code, printers, list), "const [scanner] = useState(() => bluetoothScanOf(setShown));", "const scanner = bluetoothScanOf(setShown);"],
    [printers, (code) => scanProblems(scan, code, list), "if (locked) return undefined;", "if (locked) return null;"],
    [list, (code) => scanProblems(scan, printers, code), "onAllow={onAllowLocation} />", "onAllow={onAllowLocation ?? onAllow} />"],
    [list, autoProblems, " || list.working", ""],
    [list, autoProblems, "seen.current = list.bluetooth;\n    if (auto) search();", "if (auto) search();"],
  ];
  for (const [code, problems, from, to] of cases) {
    const mutated = code.replace(from, to);
    assert.notEqual(mutated, code, `${from}: the mutation changed the source`);
    assert.ok(problems(mutated).length > 0, `${from} → ${to}: the pin noticed`);
  }
});
