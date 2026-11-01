"use client";

import {
  PRINTER_SEG_BUTTON_CLASS,
  PRINTER_SEG_OFF_CLASS,
  PRINTER_SEG_ON_CLASS,
  PRINTER_SEG_TRACK_CLASS,
} from "@/components/print/printer-classes";
import { PAPER_WIDTHS, type PaperWidth } from "@/lib/constants";
import { cn } from "@/lib/utils";

const PAPER_LABELS: Record<PaperWidth, string> = { "58mm": "58 mm", "80mm": "80 mm" };
const PAPER_QUESTION = "Paper width";

interface PaperSizeToggleProps {
  value: PaperWidth;
  disabled: boolean;
  onChange: (paper: PaperWidth) => void;
}

// Which roll is in the printer: the HTML's 32px segmented control (values 20), one pressed.
export function PaperSizeToggle({ value, disabled, onChange }: PaperSizeToggleProps) {
  return (
    <div role="group" aria-label={PAPER_QUESTION} className="flex items-center justify-between gap-3">
      <p className="text-[13.5px]">{PAPER_QUESTION}</p>
      <div className={PRINTER_SEG_TRACK_CLASS}>
        {PAPER_WIDTHS.map((paper) => (
          <button
            key={paper}
            type="button"
            aria-pressed={paper === value}
            disabled={disabled}
            onClick={() => onChange(paper)}
            className={cn(PRINTER_SEG_BUTTON_CLASS, paper === value ? PRINTER_SEG_ON_CLASS : PRINTER_SEG_OFF_CLASS)}
          >
            {PAPER_LABELS[paper]}
          </button>
        ))}
      </div>
    </div>
  );
}
