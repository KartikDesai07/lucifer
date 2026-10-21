"use client";

import type { PaymentMode } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { PAY_METHOD_CLASS, PAY_METHOD_OFF_CLASS, PAY_METHOD_ON_CLASS, PAY_METHODS_CLASS } from "@/lib/payment-sheet";

// Why a new file: PaymentModal.tsx was at the ~300-line budget; the payment-mode buttons moved here verbatim
// (CB-7 S6 slice C) to make room for the points row.
//
// U1 Task 9 (values 11.1 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.11): the HTML's segmented
// track with our five modes (Cash, Online, Due, Split, Credit); the chosen one in the HTML's SEG_ON look (today's
// per-mode colours went), announced as pressed.
interface PaymentModeGridProps {
  modes: PaymentMode[];
  mode: PaymentMode;
  onSelect: (mode: PaymentMode) => void;
  // In flight or unconfirmed: the other modes dim, the chosen one stays clear.
  locked: boolean;
}

export function PaymentModeGrid({ modes, mode, onSelect, locked }: PaymentModeGridProps) {
  return (
    <div
      data-ui="pay-methods"
      role="group"
      aria-label="Payment method"
      className={PAY_METHODS_CLASS}
      style={{ gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))` }}
    >
      {modes.map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            data-ui="pay-method"
            aria-pressed={active}
            disabled={locked}
            onClick={() => onSelect(m)}
            className={cn(PAY_METHOD_CLASS, active ? PAY_METHOD_ON_CLASS : PAY_METHOD_OFF_CLASS, BRAND_PRESS_CLASS)}
          >
            {m}
          </button>
        );
      })}
    </div>
  );
}
