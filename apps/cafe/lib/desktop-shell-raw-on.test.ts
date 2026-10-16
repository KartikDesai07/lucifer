import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { DESKTOP_PRINT_NO_REPLY_MESSAGE, DESKTOP_PRINT_TIMEOUT_MS, shellErrorMessage, type PosDesktopBridge } from "@/lib/desktop-shell";
import { desktopPrintRawOn, desktopPrintsRaw } from "@/lib/desktop-shell-printer";
import { desktopPrinterSnapshot, refreshDesktopPrinterChosen, resetDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";
import { stripComments } from "@/lib/source-pin-utils";

// Printing Phase 4 (spec 2026-10-15 §6, §5.3, §5.4): the page side of the Windows app's raw write to a Windows printer
// (printRawOn, the app 2.0.2): feature-detected, its refusals the app's own sentences, the picture's no-reply bound; and
// the app's print method kept with its printers, since text goes to a Windows printer only with "Direct to printer".

type FakeWindow = { posDesktop?: PosDesktopBridge };
function installWindow(t: { after(fn: () => void): void }, win: FakeWindow): void {
  (globalThis as unknown as { window: FakeWindow }).window = win;
  t.after(() => delete (globalThis as unknown as { window?: unknown }).window);
}

const SLIP = Uint8Array.from([0x1b, 0x40, 0x41, 0x0a]);

test("printRawOn is feature-detected: only an app that has it writes raw bytes to a Windows printer", (t) => {
  installWindow(t, { posDesktop: { version: "2.0.1", printHtml: async () => undefined, printHtmlOn: async () => undefined } });
  assert.equal(desktopPrintsRaw(), false, "an app before 2.0.2: its Windows printers print pictures");
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, printRawOn: async () => undefined } });
  assert.equal(desktopPrintsRaw(), true, "the app 2.0.2");
  installWindow(t, {});
  assert.equal(desktopPrintsRaw(), false, "not the Windows app");
});

test("the bytes go to the named Windows printer, unchanged", async (t) => {
  const calls: Array<[string, number[]]> = [];
  installWindow(t, {
    posDesktop: {
      version: "2.0.2",
      printHtml: async () => undefined,
      printRawOn: async (name: string, data: Uint8Array) => void calls.push([name, [...data]]),
    },
  });
  await desktopPrintRawOn("POS-80 Printer", SLIP);
  assert.deepEqual(calls, [["POS-80 Printer", [...SLIP]]], "one call, the printer's name and the slip's bytes");
});

test("a refusal carries the app's own sentence, which the bridge reads as it reads a picture's", async (t) => {
  const sentence = "That printer is not on this PC. Choose it again in printer setup.";
  installWindow(t, {
    posDesktop: {
      version: "2.0.2",
      printHtml: async () => undefined,
      printRawOn: async () => {
        throw new Error(`Error invoking remote method 'pos-desktop:print-raw-on': Error: ${sentence}`);
      },
    },
  });
  await assert.rejects(desktopPrintRawOn("Gone", SLIP), (error: unknown) => {
    assert.equal(shellErrorMessage(error), sentence, "the shell's sentence, unwrapped");
    return true;
  });
});

test("an app that never answers is given up after the picture's own bound", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  installWindow(t, { posDesktop: { version: "2.0.2", printHtml: async () => undefined, printRawOn: () => new Promise<void>(() => undefined) } });
  const pending = desktopPrintRawOn("POS-80 Printer", SLIP);
  t.mock.timers.tick(DESKTOP_PRINT_TIMEOUT_MS);
  await assert.rejects(pending, new Error(DESKTOP_PRINT_NO_REPLY_MESSAGE), "the no-reply sentence, as a picture's");
});

test("the Windows printers' store keeps the app's print method; an app that does not say leaves it out", async (t) => {
  resetDesktopPrinterChosen();
  t.after(resetDesktopPrinterChosen);
  let mode: string | undefined = "direct";
  installWindow(t, {
    posDesktop: {
      version: "2.0.2",
      printHtml: async () => undefined,
      listPrinters: async () => ({ selected: "POS-80", printers: [{ name: "POS-80", displayName: "POS-80" }], ...(mode === undefined ? {} : { printMode: mode as "direct" }) }),
      savePrinter: async (name: string | null) => ({ selected: name }),
    },
  });
  await refreshDesktopPrinterChosen();
  assert.deepEqual(desktopPrinterSnapshot(), { chosen: "chosen", selected: "POS-80", names: ["POS-80"], printMode: "direct" }, "Direct to printer");
  mode = "driver";
  await refreshDesktopPrinterChosen();
  assert.equal(desktopPrinterSnapshot().printMode, "driver", "Through the Windows driver: a change of method is a change of the store");
  mode = undefined;
  await refreshDesktopPrinterChosen();
  assert.equal("printMode" in desktopPrinterSnapshot(), false, "an app that does not say: no method");
  mode = "sideways";
  await refreshDesktopPrinterChosen();
  assert.equal("printMode" in desktopPrinterSnapshot(), false, "a method the page does not know: none");
});

test("PIN: a saved print method is read back into the store at once, so the next slip follows it", () => {
  const method = stripComments(readFileSync(path.join(process.cwd(), "components/print/DesktopPrintMethod.tsx"), "utf8"));
  const save = method.indexOf("const result = await savePrintMode(next);");
  const refresh = method.indexOf("void refreshDesktopPrinterChosen();");
  assert.ok(save >= 0 && refresh > save, "after the save, the store reads the app's printers and method again");
  assert.ok(method.includes('import { refreshDesktopPrinterChosen } from "@/lib/printer/desktop-printer-state";'), "from the Windows printers' store");
});
