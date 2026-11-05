"use client";

import type { ReactNode } from "react";
import { toast } from "sonner";

import {
  PRINTER_BUTTON_CLASS,
  PRINTER_DEVICE_BLOCK_CLASS,
  PRINTER_DEVICE_ROW_CLASS,
  PRINTER_HERE_DOT_CLASS,
  PRINTER_HERE_NAME_CLASS,
  PRINTER_HERE_SUB_CLASS,
  PRINTER_HERE_TONE,
  PRINTER_HERE_WORD_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { useTestPrinter } from "@/hooks/use-print-setup";
import type { PrinterHere } from "@/lib/print-agent-here";
import { testPrintSentText } from "@/lib/print-setup-text";
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
 *  signal), then its lines and buttons. Props only. */
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
      {children}
    </div>
  );
}

// Every printer of the card is printed by this device, which is online (the hook refuses a tap offline): the setup's
// words for such a printer are "Prints on this device", so the toast never says its slip waits for a device to return.
const PRINTS_HERE = { tone: "ok", text: "Prints on this device" } as const;

/** X5: an admin's Test print of a printer the setup names for this device: the setup's own test, as PrintersSetupSection
 *  calls it (POST /api/printers/:id/test, admin-only on the server; one request per tap, none while one runs). Its owners
 *  mount it for admins only, so staff never send a request the server refuses. */
export function SetupTestPrint({ printer, disabled }: { printer: PrinterHere; disabled: boolean }) {
  const testPrint = useTestPrinter();
  const test = async () => {
    try {
      await testPrint.mutateAsync(printer.id);
      toast.success(testPrintSentText(printer, PRINTS_HERE));
    } catch {
      // The hook toasted it.
    }
  };
  return (
    <Button className={PRINTER_BUTTON_CLASS} variant="outline" disabled={disabled || testPrint.isPending} onClick={() => void test()}>
      Test print
    </Button>
  );
}
