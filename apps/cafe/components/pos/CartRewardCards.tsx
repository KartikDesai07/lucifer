"use client";

import { Check, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { deadlineLine } from "@/components/public/rewards/reward-clock";
import type { CardOffer } from "@/lib/reward-card-offers";

// CB-7 S5 — the STAFF counter's list of a diner's revealed scratch cards, rendered inside CartReward. Purely
// presentational: which cards exist, and whether each can be used on THIS bill, is decided upstream (the rewards route
// allowlist + lib/reward-card-offers.ts, a preview of the server's own claim gates). A tap picks the card, a second
// tap puts it back — the same toggle idiom as the stamp rungs. A card is never picked for the counter.

/** What Cart hands down: the offers for this bill, the picked card's id, and the toggle. */
export interface CartRewardCardsState {
  offers: CardOffer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// A whole-row button, tall enough for a thumb (44 px) — the rows carry a sentence or two, so they are not chips.
const ROW_CLASS = "h-auto min-h-11 w-full min-w-0 justify-between gap-2 px-2 py-1.5 text-left";

function CardRow({
  offer,
  selected,
  nowMs,
  disabled,
  onSelect,
}: {
  offer: CardOffer;
  selected: boolean;
  nowMs: number;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
}) {
  const { card, usable, reason } = offer;
  // The handler itself refuses an unusable card: `disabled` only gates the pointer, never a stray key event.
  const handleClick = () => {
    if (!usable) return;
    onSelect(selected ? null : card.id);
  };
  return (
    <Button
      type="button"
      variant={selected ? "default" : "outline"}
      aria-pressed={selected}
      aria-label={usable ? `Use card: ${card.label}` : `Card: ${card.label} — ${reason ?? "not available"}`}
      disabled={disabled || !usable}
      onClick={handleClick}
      className={cn(ROW_CLASS, !usable && "opacity-60")}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 whitespace-normal">
        <span className="min-w-0 max-w-full text-sm font-medium">{card.label}</span>
        {card.condition && <span className="min-w-0 max-w-full text-xs font-normal opacity-80">{card.condition}</span>}
        <span className="min-w-0 max-w-full text-xs font-normal opacity-80">
          {deadlineLine("use", card.validUntil, nowMs)}
        </span>
        {!usable && reason && <span className="min-w-0 max-w-full text-xs font-normal">{reason}</span>}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </Button>
  );
}

export function CartRewardCards({
  offers,
  selectedId,
  onSelect,
  disabled,
}: CartRewardCardsState & { disabled?: boolean }) {
  // Nothing to show for a diner with no usable card — no dead chrome.
  if (offers.length === 0) return null;
  const nowMs = Date.now();
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">Scratch cards</div>
      {offers.map((offer) => (
        <CardRow
          key={offer.card.id}
          offer={offer}
          selected={offer.card.id === selectedId}
          nowMs={nowMs}
          disabled={disabled}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/**
 * The picked card as an always-visible footer row with its remove control — a free-dish card changes neither Subtotal
 * nor Total, so without this row the bill would look untouched (the same reason CartAppliedRows exists for promos).
 */
export function CartAppliedCard({
  offer,
  onClear,
  disabled,
}: {
  offer: CardOffer | undefined;
  onClear: () => void;
  disabled?: boolean;
}) {
  if (!offer) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 truncate">Scratch card: {offer.card.label}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11 shrink-0"
        onClick={onClear}
        disabled={disabled}
        aria-label="Remove scratch card"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
