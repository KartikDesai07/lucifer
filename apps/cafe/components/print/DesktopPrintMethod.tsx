"use client";

// The print-method radio block, split out of DesktopPrinterPicker.tsx to keep
// that file's size in check (same idiom as PrintHostCardParts.tsx). Renders
// only when the picker has confirmed BOTH that this shell can save a mode
// (api.savePrintMode is a function) and that it reported one (printMode is
// defined) — an older shell exposes neither.
import { useState } from "react";
import { toast } from "sonner";

import {
  DESKTOP_PRINT_MODES,
  type DesktopPrintMode,
  type DesktopPrinterApi,
} from "@/lib/desktop-shell-printer";

const SAVE_MODE_FAILED_MESSAGE = "Could not save the print method — try again.";
const SAVE_MODE_SUCCESS_MESSAGE = "Print method saved.";

const MODE_LABELS: Record<DesktopPrintMode, string> = {
  direct: "Direct to printer (recommended)",
  driver: "Through the Windows driver",
};

const MODE_DESCRIPTIONS: Record<DesktopPrintMode, string> = {
  direct:
    "The slip is sent to the printer as an image, so the paper is exactly as long as the slip.",
  driver:
    "Use only if direct printing gives blank or garbled paper. The driver's page size decides the paper length.",
};

interface DesktopPrintMethodProps {
  api: DesktopPrinterApi;
  savePrintMode: NonNullable<DesktopPrinterApi["savePrintMode"]>;
  printMode: DesktopPrintMode;
}

export function DesktopPrintMethod({ savePrintMode, printMode }: DesktopPrintMethodProps) {
  const [mode, setMode] = useState<DesktopPrintMode>(printMode);
  const [saving, setSaving] = useState(false);

  const choose = async (next: DesktopPrintMode) => {
    setSaving(true);
    try {
      const result = await savePrintMode(next);
      setMode(result.printMode);
      toast.success(SAVE_MODE_SUCCESS_MESSAGE);
    } catch {
      toast.error(SAVE_MODE_FAILED_MESSAGE);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2 border-t pt-3">
      <p className="font-medium">Print method</p>
      {DESKTOP_PRINT_MODES.map((value) => (
        <label key={value} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name="desktop-print-mode"
            value={value}
            checked={mode === value}
            disabled={saving}
            onChange={() => void choose(value)}
            className="mt-1"
          />
          <span>
            <span className="block">{MODE_LABELS[value]}</span>
            <span className="block text-xs text-muted-foreground">{MODE_DESCRIPTIONS[value]}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
