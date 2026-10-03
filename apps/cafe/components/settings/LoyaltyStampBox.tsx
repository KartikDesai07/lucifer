"use client";

import { AlertCircle, Gift, Ticket } from "lucide-react";

import { cn } from "@/lib/utils";

interface LoyaltyStampBoxProps {
  at: number;
  hasReward: boolean;
  hasCode: boolean;
  hasError: boolean;
  disabled: boolean;
  onOpen: () => void;
}

// One box on the stamp card (settings pass slice 8). A reward is a solid blue
// box with a gift mark; a reward that also gives a promo code has a small
// ticket in the corner; an empty box is dashed. A reward row with a problem
// (a failed Save lands its message inside the closed panel) is marked red with
// an alert icon top-left, so the owner can find which box to open. At the
// reward cap an EMPTY box is disabled — it could not take a reward.
export function LoyaltyStampBox({ at, hasReward, hasCode, hasError, disabled, onOpen }: LoyaltyStampBoxProps) {
  const label =
    (hasReward ? `Stamp ${at}: edit its reward` : `Stamp ${at}: add a reward`) +
    (hasCode ? ", gives a promo code" : "") +
    (hasError ? ", needs fixing" : "");

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 text-sm transition-colors",
        "enabled:hover:bg-brand-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
        hasReward
          ? "border-brand-primary bg-brand-primary-soft font-semibold text-brand-ink"
          : "border-dashed border-brand-rule text-brand-muted",
        hasError && "border-solid border-brand-danger",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {hasError && (
        <AlertCircle className="absolute left-1 top-1 h-3.5 w-3.5 text-brand-danger" aria-hidden="true" />
      )}
      {hasCode && <Ticket className="absolute right-1 top-1 h-3 w-3 text-brand-primary" aria-hidden="true" />}
      {hasReward && <Gift className="h-4 w-4" aria-hidden="true" />}
      <span>{at}</span>
    </button>
  );
}
