"use client";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BACKUP_PRINTER_NOTE, backupChoicesOf } from "@/lib/print-setup-form";

const NONE = "none";

// Printing redesign, Phase 3 Session 3B (spec §9.4, §11): the printer form's backup printer. None, or another printer
// routing sends slips to; a saved one that stopped taking slips is still offered ("(not in use)") so a save keeps it, and
// a saved one the form cannot find shows as none (the body then sends null).
export function BackupPrinterSelect({ printerId, value, printers, onChange }: { printerId: string | null; value: string; printers: readonly PrinterConfig[]; onChange: (id: string) => void }) {
  const choices = backupChoicesOf(printers, printerId, value);
  return (
    <div className="space-y-1">
      <Select value={choices.some((choice) => choice.id === value) ? value : NONE} onValueChange={(next) => onChange(next === NONE ? "" : next)}>
        <SelectTrigger aria-label="Backup printer" className={PRINTER_INPUT_CLASS}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No backup printer</SelectItem>
          {choices.map((choice) => (
            <SelectItem key={choice.id} value={choice.id}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-brand-muted">{BACKUP_PRINTER_NOTE}</p>
    </div>
  );
}
