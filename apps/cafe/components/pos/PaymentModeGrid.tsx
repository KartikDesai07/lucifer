"use client";

import { PAY_STYLES, type PaymentMode } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Why a new file: PaymentModal.tsx was at the ~300-line budget; the payment-mode buttons moved here verbatim
// (CB-7 S6 slice C) to make room for the points row.
interface PaymentModeGridProps {
  modes: PaymentMode[];
  mode: PaymentMode;
  onSelect: (mode: PaymentMode) => void;
  // In flight or unconfirmed: the other modes dim, the chosen one stays clear.
  locked: boolean;
}

export function PaymentModeGrid({ modes, mode, onSelect, locked }: PaymentModeGridProps) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {modes.map((m) => {
        const style = PAY_STYLES[m];
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            disabled={locked}
            onClick={() => onSelect(m)}
            className={cn(
              "rounded-md border py-2 text-sm font-semibold transition disabled:cursor-not-allowed",
              // Locked (in flight / unconfirmed): the other modes dim, the chosen one stays clear.
              active
                ? `${style.bg} ${style.color} border-current ring-2 ring-current`
                : "enabled:hover:bg-muted disabled:opacity-50",
            )}
          >
            {style.label}
          </button>
        );
      })}
    </div>
  );
}
