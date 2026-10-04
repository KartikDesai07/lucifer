import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { printAgentHeaders } from "@/lib/print-agent-calls";
import { BILL_PRINTER_KEY, billPrinterIdOf, readBillPrinterId, writeBillPrinterId } from "@/lib/print-bill-printer";

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
