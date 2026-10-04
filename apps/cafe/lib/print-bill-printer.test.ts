import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { printAgentHeaders } from "@/lib/print-agent-calls";
import { routablePrinterOf, type PrinterConfig } from "@pos/shared/print-printers";
import { BILL_PRINTER_DEFAULT, BILL_PRINTER_KEY, billPrinterChoiceOf, billPrinterIdOf, readBillPrinterId, writeBillPrinterId } from "@/lib/print-bill-printer";

// Printing redesign, Phase 2 Session 2D (plan decision 7): this device's own bill printer, kept on the device and
// sent with every print request; and the two page signals 2D adds (the not-routed notice, the dot in printers mode).

const ID = "64f0000000000000000000aa";

test("2D: the stored bill printer is a printer id or nothing; storage never throws (no window here)", () => {
  assert.equal(billPrinterIdOf(ID), ID);
  assert.equal(billPrinterIdOf(` ${ID} `), null, "never trimmed into an id");
  assert.equal(billPrinterIdOf("not-an-id"), null);
  assert.equal(billPrinterIdOf(null), null);
  assert.equal(readBillPrinterId(), null, "no storage: the default bill printer");
  writeBillPrinterId(ID);
  writeBillPrinterId(null);
  assert.equal(BILL_PRINTER_KEY, "pos.bill-printer.v1");
});

test("2D: every print request names this device's bill printer when one is chosen; none chosen, no header", () => {
  assert.equal(printAgentHeaders("dev-a", true, null, [], ID)["x-pos-bill-printer"], ID, "the chosen printer rides the request");
  assert.equal(printAgentHeaders("dev-a", false, null, [], ID)["x-pos-bill-printer"], ID, "an End of day or a reprint carries it too");
  assert.equal(printAgentHeaders("dev-a", true, null, [], null)["x-pos-bill-printer"], undefined, "none chosen: the default bill printer");
  assert.equal(printAgentHeaders("dev-a", true)["x-pos-bill-printer"], undefined, "the default reads this device's storage (none here)");
  assert.deepEqual(printAgentHeaders("", true, null, [], ID), {}, "no identity: nothing at all, as before");
});

const NO_SLIPS = { bill: false, kotStations: [], kotAll: false, notices: false, eod: false };
function printer(id: string, name: string, slips: Partial<PrinterConfig["slips"]>, over: Partial<PrinterConfig> = {}): PrinterConfig {
  return {
    id,
    name,
    connection: { kind: "lan", host: "192.168.1.50", port: 9100 },
    primaryDeviceId: `dev-${name}`,
    order: 0,
    paper: 80,
    slips: { ...NO_SLIPS, ...slips },
    copies: { kot: 1, bill: 1 },
    enabled: true,
    ...over,
  };
}

test("2D final review (M-6), as changed at the 2D review gate: the bill picker shows where this device's bills print, exactly as routing chooses", () => {
  const P1 = "64f0000000000000000000a1";
  const BAR = "64f0000000000000000000b2";
  const counter = printer(P1, "Printer 1", { bill: true, kotAll: true, notices: true, eod: true });
  const bar = printer(BAR, "Bar printer", { bill: true, kotStations: ["s-bar"], notices: true }, { order: 1 });
  const barNoBill = { ...bar, slips: { ...bar.slips, bill: false } };
  const barOff = { ...bar, enabled: false };
  const cases: Array<{ name: string; printers: PrinterConfig[]; chosen: string | null; value: string; offered: string[]; note: RegExp | null }> = [
    { name: "none chosen", printers: [counter, bar], chosen: null, value: BILL_PRINTER_DEFAULT, offered: [P1, BAR], note: null },
    { name: "a bill printer chosen", printers: [counter, bar], chosen: BAR, value: BAR, offered: [P1, BAR], note: null },
    { name: "chosen, then Bill unticked there", printers: [counter, barNoBill], chosen: BAR, value: BILL_PRINTER_DEFAULT, offered: [P1], note: /^Bar printer no longer takes bills, so this device's bills go to the default\./ },
    { name: "chosen, then switched off", printers: [counter, barOff], chosen: BAR, value: BILL_PRINTER_DEFAULT, offered: [P1], note: /switched off or gone, so bills go to the default/ },
    { name: "chosen, then deleted", printers: [counter], chosen: BAR, value: BILL_PRINTER_DEFAULT, offered: [P1], note: /switched off or gone, so bills go to the default/ },
  ];
  for (const c of cases) {
    const choice = billPrinterChoiceOf(c.printers, c.chosen);
    // The server sends this device's bills to its choice while that printer is routable and takes bills
    // (chosenBillPrinter, the 2D review gate), else to the default bill printer: the picker must say the same.
    const routed = c.chosen === null ? null : routablePrinterOf(c.printers, c.chosen);
    assert.equal(choice.value, routed !== null && routed.slips.bill ? routed.id : BILL_PRINTER_DEFAULT, `${c.name}: the picker shows the printer routing uses`);
    assert.equal(choice.value, c.value, `${c.name}: value`);
    assert.deepEqual(choice.options.map((p) => p.id), c.offered, `${c.name}: the printers offered, the shown one among them`);
    if (c.note === null) assert.equal(choice.note, null, `${c.name}: no note`);
    else assert.match(choice.note ?? "", c.note, `${c.name}: the note`);
  }
});

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

test("PIN (2D, the 2C review gate's M-5): a slip no printer takes says so instead of doing nothing", () => {
  const hook = src("hooks/use-host-routing.ts");
  assert.equal((hook.match(/if \(result\.outcome === "not-routed"\) toast\(PRINT_JOB_NOT_ROUTED_MESSAGE\);/g) ?? []).length, 2, "the routed print and the moved slip both say it");
  assert.match(src("lib/print-routing.ts"), /export const PRINT_JOB_NOT_ROUTED_MESSAGE =\s*"No printer takes this slip\. To print notices, switch Notices on for a printer in Printer setup\.";/);
});

test("PIN (2D, spec §6.6): in printers mode Where slips print says each slip prints at its printer, and offers no printing device", () => {
  const where = src("components/print/PrintWhereSection.tsx");
  const branch = where.indexOf("printersMode === true ? (");
  assert.ok(branch >= 0 && branch < where.indexOf("isHostDevice ? ("), "decided before the printing-device branches");
  assert.ok(where.includes('"Printers are set up: each slip prints at its printer (Printer setup → Printers)."'));
  assert.match(src("components/print/PrinterSetupCard.tsx"), /const printersMode = printersModeOn\(usePrintersRead\(deviceId !== ""\)\.printers\);[\s\S]*printersMode=\{printersMode\}/);
});

test("PIN (2D, the 2D gate's review, M-5): only the agent's printers read subscribes to print-setup; a screen that shows printers reads the same entry", () => {
  const hook = src("hooks/use-agent-printers.ts");
  assert.equal((hook.match(/subscribeRealtime\(/g) ?? []).length, 1, "one subscription, in usePrinters");
  assert.match(hook, /export function useDotPrinters\(deviceId: string\): PrinterDotPrinters \{\s*const \{ printers \} = usePrintersRead\(deviceId !== ""\);/, "the dot reads without subscribing");
});

test("PIN (2D, spec §10): the top-bar button and the printer panel give the dot this device's view of printers mode", () => {
  for (const rel of ["components/print/PrinterStatusButton.tsx", "components/print/PrinterPanel.tsx"]) {
    const file = src(rel);
    assert.match(file, /const \{ isHostDevice, deviceId \} = usePrintHostContext\(\);/, `${rel}: the device id from the one context read`);
    assert.match(file, /const dotPrinters = useDotPrinters\(deviceId\);/, `${rel}: the printers read the agent already makes`);
    assert.match(file, /printerDotOf\(\{[^}]*\bprinters: dotPrinters,[^}]*\}\)/, `${rel}: the dot gets it (before deviceOffline: an older pin's mutation reads "deviceOffline: !online, desktopChosen }")`);
  }
});
