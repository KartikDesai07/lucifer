"use client";

import type { ReactNode } from "react";

import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import {
  PRINTER_BUTTON_CLASS,
  PRINTER_DEVICE_BLOCK_CLASS,
  PRINTER_DEVICE_INDENT_CLASS,
  PRINTER_DEVICE_ROW_CLASS,
  PRINTER_HERE_DOT_CLASS,
  PRINTER_HERE_NAME_CLASS,
  PRINTER_HERE_SUB_CLASS,
  PRINTER_HERE_TONE,
  PRINTER_HERE_WORD_CLASS,
  PRINTER_NOTE_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useTestPrinterTap } from "@/hooks/use-print-setup";
import type { PrinterHere } from "@/lib/print-agent-here";
import { printerRowState, testPrintBlock } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

// Printers on this device (PX-3 Task 10b, spec §6.6 item 2; mockup t-settings-pm): the parts its two owners share, so
// neither copies the other's. DevicePrinterSection draws this device's own printer with them, OtherDevicePrinters the POS
// app's other printers; each keeps its own calls (Reconnect, Remove) and draws them as the block's children.

export interface PrinterBlockProps {
  name: string;
  sub: string;
  tone: keyof typeof PRINTER_HERE_TONE;
  word: string;
  children: ReactNode;
}

/** One printer: the On this device row (the 9px dot, the name over its sub, the state word; the colour is never the only
 *  signal), then its lines and buttons, all under the name (the mockup's 19px indent). Props only. */
export function PrinterBlock({ name, sub, tone, word, children }: PrinterBlockProps) {
  const look = PRINTER_HERE_TONE[tone];
  return (
    <div className={PRINTER_DEVICE_BLOCK_CLASS}>
      <div className={PRINTER_DEVICE_ROW_CLASS}>
        <span aria-hidden="true" className={cn(PRINTER_HERE_DOT_CLASS, look.dot)} />
        <p className={PRINTER_HERE_NAME_CLASS}>
          {name}
          <span className={PRINTER_HERE_SUB_CLASS}>{sub}</span>
        </p>
        <span className={cn(PRINTER_HERE_WORD_CLASS, look.word)}>{word}</span>
      </div>
      <div className={PRINTER_DEVICE_INDENT_CLASS}>{children}</div>
    </div>
  );
}

// The panel never reads the devices (SR-2: no request of its own): a printer another device writes by the setup (one this
// device has taken over) then reads as "unknown", so its toast never claims the slip waits for that device.
const NO_DEVICES: PrintDeviceSummary[] = [];

/** X5: an admin's Test print of a printer the setup names for this device: the setup page's own test, rule and toast
 *  (POST /api/printers/:id/test, admin-only on the server; one request per tap, none while one runs). Where the setup
 *  page would not test it (the 2D review gate's M-4: a printer this device writes but cannot print now, whose slip would
 *  only wait), it is disabled with the setup's reason. `localIds`: the printers this device prints now (the agent's).
 *  Its owners mount it for admins only, so staff never send a request the server refuses. */
export function SetupTestPrint({ printer, localIds, disabled }: { printer: PrinterHere; localIds: readonly string[]; disabled: boolean }) {
  const { deviceId } = usePrintHostContext();
  const { printers } = usePrintersRead(deviceId !== "");
  const testPrint = useTestPrinterTap();
  const config = printers.find((candidate) => candidate.id === printer.id);
  if (config === undefined) return null;
  // The entry's own (held) state, and whether it is one of the app's printers: as the setup page reads its row.
  const here = { deviceId, localIds, canPrint: printer.status === "connected", ownState: printer.nativeId !== undefined };
  const blocked = testPrintBlock(config, printers, here);
  const state = printerRowState(config, NO_DEVICES, { ...here, devicesFailed: true });
  return (
    <>
      <Button className={PRINTER_BUTTON_CLASS} variant="outline" disabled={disabled || blocked !== null || testPrint.pending} onClick={() => void testPrint.run(config, state)}>
        Test print
      </Button>
      {blocked !== null && <p className={cn(PRINTER_NOTE_CLASS, "basis-full")}>{blocked}</p>}
    </>
  );
}
