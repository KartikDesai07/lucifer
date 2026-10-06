import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { UseReactToPrintOptions } from "react-to-print";
import { stripComments } from "@/lib/source-pin-utils";
import { slipPrintOptions, type PosDesktopBridge } from "@/lib/desktop-shell";
import { desktopPrintsOnNamed } from "@/lib/desktop-shell-printer";
import { printConfigOf, settingsForPaper } from "@/lib/print";
import type { Settings } from "@/types";

// Printing redesign, Phase 2 Session 2E (spec §9.2): several printers on one Windows PC. A printer job names its Windows
// printer (printHtmlOn, desktop 1.11.0) and is drawn for that printer's paper; the page names a printer only on an app
// that can print on one, and everything else prints exactly as before.

const CAFE = process.cwd();
const src = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));

type FakeWindow = { posDesktop?: PosDesktopBridge };
function installWindow(t: { after(fn: () => void): void }, win: FakeWindow): void {
  (globalThis as unknown as { window: FakeWindow }).window = win;
  t.after(() => delete (globalThis as unknown as { window?: unknown }).window);
}

function fakeIframe(body: string): HTMLIFrameElement {
  const doc = { title: "", documentElement: { outerHTML: `<html><head></head><body>${body}</body></html>` } };
  return { contentDocument: doc } as unknown as HTMLIFrameElement;
}

test("2E: a slip with a Windows printer prints there through printHtmlOn; a slip with none through printHtml, as before", async (t) => {
  const calls: string[] = [];
  installWindow(t, {
    posDesktop: {
      version: "1.11.0",
      printHtml: async () => void calls.push("chosen"),
      printHtmlOn: async (_html: string, name: string) => void calls.push(`on ${name}`),
    },
  });
  assert.equal(desktopPrintsOnNamed(), true, "the app prints on a named printer");
  await slipPrintOptions<UseReactToPrintOptions>({}, "Kitchen TVS").print?.(fakeIframe("Paneer Tikka x1"));
  await slipPrintOptions<UseReactToPrintOptions>({}).print?.(fakeIframe("Filter Coffee x2"));
  assert.deepEqual(calls, ["on Kitchen TVS", "chosen"], "a named printer, then this PC's chosen printer");
});

test("2E: an older Windows app cannot print on a named printer, so the page names none there", (t) => {
  installWindow(t, { posDesktop: { version: "1.10.0", printHtml: async () => undefined } });
  assert.equal(desktopPrintsOnNamed(), false, "no printHtmlOn: one printer, its chosen one");
});

test("2E: a slip for a printer is drawn for that printer's paper, as if the cafe's paper setting were its own", () => {
  const settings = { billPaperWidth: "80mm", kotPaperWidth: "80mm", restaurantName: "Cafe" } as unknown as Settings;
  const narrow = settingsForPaper(settings, "58mm");
  assert.equal(printConfigOf(narrow).kot.paperWidth, "58mm", "the KOT");
  assert.equal(printConfigOf(narrow).bill.paperWidth, "58mm", "and the bill");
  assert.equal((narrow as unknown as { restaurantName: string }).restaurantName, "Cafe", "everything else as set");
  assert.equal(printConfigOf(settings).kot.paperWidth, "80mm", "the cafe's own settings are untouched");
  assert.equal(settingsForPaper(undefined, "58mm"), undefined, "settings not read yet: the defaults, as before");
});

test("PIN (2E): each slip carries its printer's target from the agent to the Windows app, and is drawn for its paper", () => {
  const hook = src("hooks/use-print-agent.ts");
  assert.match(hook, /printAgentSlipOf\(job, cafeDateString\(\), job\.printerId === undefined \? undefined : targetsRef\.current\[job\.printerId\]\)/, "the job's printer's target rides its slip");
  const bridge = src("hooks/use-print-host-bridge.ts");
  assert.match(bridge, /const target = current\?\.kind === "slip" \? current\.slip\.target : undefined;/);
  // Session 2F1 (deliberate change): one of the POS app's printers too (raster: the app's id and the printer's paper).
  assert.match(bridge, /const raster = target\?\.nativeId === undefined \? undefined : \{ nativeId: target\.nativeId, paper: target\.paper \};/);
  assert.equal((bridge.match(/, target\?\.printerName, raster\)\);/g) ?? []).length, 3, "every surface prints on the slip's printer");
  assert.match(bridge, /pageStyle: receiptPageStyle\(target\?\.paper \?\? printCfg\.kot\.paperWidth\),/, "its paper on the page");
  assert.match(bridge, /pageStyle: receiptPageStyle\(target\?\.paper \?\? printCfg\.bill\.paperWidth\),/);
  assert.match(bridge, /pageStyle: target === undefined \? RECEIPT_PAGE_STYLE : receiptPageStyle\(target\.paper\),/, "End of day: 80 mm as before, a Windows printer's own roll since 2E");
  const sources = src("components/print/PrintHostPrintSources.tsx");
  assert.match(sources, /const printSettings = slip\?\.target === undefined \? settings\.data : settingsForPaper\(settings\.data, slip\.target\.paper\);/, "and its paper in the slip");
  const shell = src("lib/desktop-shell.ts");
  assert.match(shell, /printerName !== undefined && shell\.printHtmlOn !== undefined \? shell\.printHtmlOn\(html, printerName\) : shell\.printHtml\(html\)/);
});

test("PIN (2E): the agent leases, offers for direct print and is kicked only for the printers no refusal holds", () => {
  const hook = src("hooks/use-print-agent.ts");
  assert.match(hook, /lease: \(printerIds\) => apiSend<PrintLeaseData>\(LEASE_URL, "POST", \{ deviceId, tabId, tokenSlips: true, \.\.\.printerIdsBody\(printerIds\) \}\),/, "the lease names what the agent says is open");
  assert.match(hook, /readyPrinters: readyNow,/, "Session 2F1: those of them that can print now");
  // The 2F1 review gate (M-1, deliberate change): every printer job, named here or not, holds its own printer's line.
  assert.match(hook, /lineOf: \(job\) => job\.printerId \?\? PRINT_DEVICE_LINE,/, "a printer job's refusal holds its own printer's line, never the device line");
  assert.match(hook, /const offReady = setReadyPrintersSource\(\(\) => agent\.openPrinters\(\)\);/, "direct print names only open printers");
  // The 2E review gate (M-5): the wake poll lives in its own hook.
  const both = hook + src("hooks/use-print-agent-wake.ts");
  assert.equal((both.match(/jobsForMeLeasable\([^)]*, agent\.openPrinters\(\)\)/g) ?? []).length, 2, "the pulse and the wake kick only for open printers");
  // Session 2F1 (deliberate change): elsewhere any change of this device's printers (printersState) releases one.
  assert.match(hook, /printerState: \(\) => \(isDesktopShell\(\) \? desktopPrinterSnapshot\(\) : printersState\(\)\),/, "a Windows printer list read again releases a hold");
});

test("PIN (2E): a Windows printer that failed is looked up again, so one renamed or removed in Windows stops being this PC's", () => {
  const hook = src("hooks/use-print-agent.ts");
  // Session 2F1 (deliberate change): only a Windows printer's target (a POS app printer's has no Windows list to read).
  assert.match(hook, /if \(!result\.ok && job\.printerId !== undefined && targetsRef\.current\[job\.printerId\]\?\.printerName !== undefined\) void refreshDesktopPrinterChosen\(\);/);
});

test("PIN (2E): every job of a slip leased to this tab is handed to the agent, from an order answer and from an enqueue", () => {
  const seam = src("hooks/use-host-routing.ts");
  assert.match(seam, /for \(const job of ref\.alsoLeased \?\? \[\]\) deliverLeasedJob\(job\);/, "an order answer: the slip's other leased jobs");
  assert.match(seam, /if \(result\.outcome === "queued"\) for \(const job of leasedJobsOf\(result\.jobs \?\? \[\]\)\.filter\(\(leased\) => leased\.id !== result\.leased\?\.id\)\) deliverLeasedJob\(job\);/, "an enqueue: every job of the slip");
});

test("PIN (2E): the agent's printers follow the Windows app's printer list, read again with every printers read", () => {
  const hook = src("hooks/use-agent-printers.ts");
  assert.match(hook, /if \(enabled && isDesktopShell\(\)\) void refreshDesktopPrinterChosen\(\);/, "a printer added in Windows is seen with the next printers read");
  assert.match(hook, /lane === "desktop" \? \{ selected: snapshot\.selected, names: snapshot\.names, named: desktopPrintsOnNamed\(\) \} : null/);
});
