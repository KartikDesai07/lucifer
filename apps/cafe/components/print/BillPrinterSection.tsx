"use client";

import { useEffect, useState } from "react";
import { ReceiptText } from "lucide-react";

import { defaultBillPrinterOf, printersModeOn, routablePrinters } from "@pos/shared/print-printers";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { BILL_PRINTER_DEFAULT, billPrinterChoiceOf, readBillPrinterId, writeBillPrinterId } from "@/lib/print-bill-printer";

const DESCRIPTION = "Bills and End of day from this device print here.";

// Printing redesign, Phase 2 Session 2D (plan decision 7; spec §11 "Bill printer for this device"): in printers
// mode, this device chooses which bill printer its bills and End of day go to; kept on this device and sent with
// every print request. Only printers routing would send a bill to are offered (the 2B gate's ruling R4). The
// printers are the agent's read (one cache entry): no request of its own.
export function BillPrinterSection() {
  const { deviceId } = usePrintHostContext();
  const { printers } = usePrintersRead(deviceId !== "");
  const [chosen, setChosen] = useState<string | null>(null);
  useEffect(() => {
    setChosen(readBillPrinterId());
  }, []);

  const billPrinters = routablePrinters(printers).filter((printer) => printer.slips.bill);
  if (!printersModeOn(printers) || billPrinters.length === 0) return null;
  const fallback = defaultBillPrinterOf(printers);
  // What routing does with this device's choice (Session 2D's final review, M-6): never "Default" while bills
  // still go to the chosen printer.
  const { value, options, note } = billPrinterChoiceOf(printers, chosen);

  const choose = (next: string) => {
    const id = next === BILL_PRINTER_DEFAULT ? null : next;
    writeBillPrinterId(id);
    setChosen(id);
  };

  return (
    <PrinterSection icon={ReceiptText} title="Bill printer for this device" description={DESCRIPTION}>
      <Select value={value} onValueChange={choose}>
        <SelectTrigger aria-label="Bill printer for this device" className={PRINTER_INPUT_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={BILL_PRINTER_DEFAULT}>Default ({fallback?.name ?? "none"})</SelectItem>
          {options.map((printer) => (
            <SelectItem key={printer.id} value={printer.id}>
              {printer.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {note !== null && <p className="text-xs text-brand-muted">{note}</p>}
    </PrinterSection>
  );
}
