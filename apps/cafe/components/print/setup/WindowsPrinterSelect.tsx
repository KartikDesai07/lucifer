"use client";

import { PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { desktopPrinterSavesToFile } from "@/lib/desktop-shell-printer";

const PLACEHOLDER = "Choose the Windows printer";
const NONE = "Windows reports no printer on this PC. Add the printer in Windows Settings, then open this form again.";
const READING = "Reading the printers on this PC…";

// Printing redesign, Phase 2 Session 2E (spec §9.2, §11): on the Windows app a printer of this PC is one of the
// printers Windows reports, chosen by its name (never typed), so one PC prints several printers, each its own Windows
// printer. A device that writes a file instead of paper is listed but cannot be chosen (the Windows app refuses it).
export function WindowsPrinterSelect({ names, value, onChange }: { names: readonly string[] | null; value: string; onChange: (name: string) => void }) {
  if (names === null) return <p className="text-brand-muted">{READING}</p>;
  if (names.length === 0) return <p className="text-brand-muted">{NONE}</p>;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label="Windows printer" className={PRINTER_INPUT_CLASS}>
        <SelectValue placeholder={PLACEHOLDER} />
      </SelectTrigger>
      <SelectContent>
        {names.map((name) => (
          <SelectItem key={name} value={name} disabled={desktopPrinterSavesToFile(name)}>
            {desktopPrinterSavesToFile(name) ? `${name} (saves a file, cannot be used)` : name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
