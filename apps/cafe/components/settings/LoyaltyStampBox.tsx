"use client";

import { AlertCircle, Gift, Ticket } from "lucide-react";

import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { cn } from "@/lib/utils";

interface LoyaltyStampBoxProps {
  at: number;
  hasReward: boolean;
  hasCode: boolean;
  hasError: boolean;
  disabled: boolean;
  onOpen: () => void;
  // What the box is called in its aria label; the stamp card says "Stamp", a scratch-card level "Box".
  noun?: string;
}

const DEFAULT_NOUN = "Stamp";

// One box on the stamp card (settings pass slice 8). A reward is a solid blue
// box with a gift mark; a reward that also gives a promo code has a small
// ticket in the corner; an empty box is dashed. A reward row with a problem
// (a failed Save lands its message inside the closed panel) is marked red with
// an alert icon top-left, so the owner can find which box to open. At the
// reward cap an EMPTY box is disabled — it could not take a reward. The new UI (2026-11-09): the settings tile colours
// (a reward = the selected tile's primary rule on the info tint), the Add button's dashed rule for an empty box.
export function LoyaltyStampBox({
  at,
  hasReward,
  hasCode,
  hasError,
  disabled,
  onOpen,
  noun = DEFAULT_NOUN,
}: LoyaltyStampBoxProps) {
  const label =
    (hasReward ? `${noun} ${at}: edit its reward` : `${noun} ${at}: add a reward`) +
    (hasCode ? ", gives a promo code" : "") +
    (hasError ? ", needs fixing" : "");

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative flex aspect-square flex-col items-center justify-center gap-1 rounded-[10px] border-2 text-sm transition-colors",
        `enabled:pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS}`,
        hasReward
          ? "border-primary bg-status-info-tint font-semibold text-foreground"
          : "border-dashed border-subtle-foreground text-muted-foreground",
        hasError && "border-solid border-status-bad",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {hasError && (
        <AlertCircle className="absolute left-1 top-1 h-3.5 w-3.5 text-status-bad-ink" aria-hidden="true" />
      )}
      {hasCode && <Ticket className="absolute right-1 top-1 h-3 w-3 text-primary" aria-hidden="true" />}
      {hasReward && <Gift className="h-4 w-4" aria-hidden="true" />}
      <span>{at}</span>
    </button>
  );
}
