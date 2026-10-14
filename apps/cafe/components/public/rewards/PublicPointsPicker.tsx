"use client";

import { Check, Coins } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_PRESS_CLASS } from "@/components/public/public-ui";
import { useDinerCards } from "@/components/public/rewards/use-diner-cards";
import { CART_POINTS_LABEL, cartPointsDetail } from "@pos/shared/public-diner-cards";

// CB-7 S6 — the cart's "Use my points" row. One tap asks to use the points on this order, a second tap lets the ask
// go. It is only an ASK: nothing is spent here or when the cafe accepts the order, so the total never changes and no
// rupee figure is shown — the counter takes the points off when the bill is paid. Reads the wallet the Rewards tab
// (and the card picker) already caches — no fetch of its own; renders nothing without a balance to use.
const ROW_CLASS =
  "flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50";

interface PublicPointsPickerProps {
  // The signed-in diner's mobile (the wallet's cache key); null = signed out or cards off.
  identity: string | null;
  selected: boolean;
  // `true` = ask to use the points, `false` = let the ask go.
  onSelect: (on: boolean) => void;
  disabled?: boolean;
}

export function PublicPointsPicker({ identity, selected, onSelect, disabled = false }: PublicPointsPickerProps) {
  const { data } = useDinerCards(identity);
  const balance = data?.pointsBalance;
  if (balance === undefined || balance <= 0) return null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(!selected)}
      className={cn(ROW_CLASS, PUB_PRESS_CLASS, selected ? "border-primary bg-primary/10" : "bg-card")}
    >
      {selected ? (
        <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      ) : (
        <Coins className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium">{CART_POINTS_LABEL}</span>
        <span className="block break-words text-xs text-muted-foreground">{cartPointsDetail(balance)}</span>
      </span>
    </button>
  );
}
