"use client";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { PAPER_WIDTHS, type PaperWidth } from "@/lib/constants";

const PAPER_LABELS: Record<PaperWidth, string> = { "58mm": "58 mm", "80mm": "80 mm" };
const PAPER_QUESTION = "Paper size";

interface PaperSizeToggleProps {
  value: PaperWidth;
  disabled: boolean;
  onChange: (paper: PaperWidth) => void;
}

// Which roll is in the printer: a two-column grid of 44px buttons, one pressed.
export function PaperSizeToggle({ value, disabled, onChange }: PaperSizeToggleProps) {
  return (
    <div role="group" aria-label={PAPER_QUESTION} className="space-y-2">
      <p className="text-sm font-medium text-brand-ink">{PAPER_QUESTION}</p>
      <div className="grid grid-cols-2 gap-2">
        {PAPER_WIDTHS.map((paper) => (
          <Button
            key={paper}
            type="button"
            variant={paper === value ? "default" : "outline"}
            aria-pressed={paper === value}
            disabled={disabled}
            onClick={() => onChange(paper)}
            className={PRINTER_ACTION_CLASS}
          >
            {PAPER_LABELS[paper]}
          </Button>
        ))}
      </div>
    </div>
  );
}
