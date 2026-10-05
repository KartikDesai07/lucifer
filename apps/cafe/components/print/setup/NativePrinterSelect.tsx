"use client";

import { NATIVE_TYPE_LABELS } from "@/components/print/printer-type";
import { PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PoolPrinter } from "@/lib/printer/native-pool";

const PLACEHOLDER = "Choose the printer on this device";
const NONE = "This device has no printer yet. Connect one under Printer on this device, then open this form again.";

// Printing redesign, Phase 2 Session 2F1 (spec §9.2, §11): on the POS app with bridge v2 a printer of this device is
// one of the app's printers, chosen from its list (never typed), so one phone or tablet prints several printers. A
// network printer chosen here becomes a network printer this device prints; a Bluetooth, BLE or USB one keeps the
// app's own spelling of its address.
export function NativePrinterSelect({ printers, value, onChange }: { printers: readonly PoolPrinter[]; value: string; onChange: (id: string) => void }) {
  if (printers.length === 0) return <p className="text-brand-muted">{NONE}</p>;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Printer on this device" className={PRINTER_INPUT_CLASS}>
        <SelectValue placeholder={PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {printers.map((entry) => (
          <SelectItem key={entry.id} value={entry.id}>
            {entry.printer.name} · {NATIVE_TYPE_LABELS[entry.printer.transport]}
            {entry.printer.transport === "tcp" ? ` ${entry.id.slice("tcp:".length)}` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
