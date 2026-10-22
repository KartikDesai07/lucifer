"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { deadlineLine } from "@/components/public/rewards/reward-clock";
import type { CardOffer } from "@/lib/reward-card-offers";
import {
  POS_BILL_LABEL_CLASS,
  POS_BILL_LINK_CLASS,
  POS_BILL_ROW_CLASS,
  POS_PANEL_PICK_CLASS,
  POS_PANEL_PICK_OFF_CLASS,
  POS_PANEL_PICK_ON_CLASS,
} from "@/lib/pos-layout";

// CB-7 S5 — the STAFF counter's list of a diner's revealed scratch cards, rendered inside CartReward. Purely
// presentational: which cards exist, and whether each can be used on THIS bill, is decided upstream (the rewards route
// allowlist + lib/reward-card-offers.ts, a preview of the server's own claim gates). A tap picks the card, a second
// tap puts it back — the same toggle idiom as the stamp rungs. A card is never picked for the counter.
// U1 Task 5 (design 6.7): the rows sit in the Bill options panel's Reward section as the HTML popover's pickup buttons
// (lib/pos-layout.ts POS_PANEL_PICK_*); the picked card's bill row is the HTML's charge row with its "Remove" link.

/** What Cart hands down: the offers for this bill, the picked card's id, and the toggle. */
export interface CartRewardCardsState {
  offers: CardOffer[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

// A whole-row button, tall enough for a thumb (44 px) — the rows carry a sentence or two, so they are not chips.
const ROW_CLASS = "min-h-11 w-full items-center justify-between gap-2";

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
    <button
      type="button"
      aria-pressed={selected}
      aria-label={usable ? `Use card: ${card.label}` : `Card: ${card.label} — ${reason ?? "not available"}`}
      disabled={disabled || !usable}
      onClick={handleClick}
      className={cn(
        POS_PANEL_PICK_CLASS,
        ROW_CLASS,
        selected ? POS_PANEL_PICK_ON_CLASS : POS_PANEL_PICK_OFF_CLASS,
        !usable && "opacity-60",
        BRAND_PRESS_CLASS,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5 whitespace-normal">
        <span className="min-w-0 max-w-full text-[13px] font-medium">{card.label}</span>
        {card.condition && <span className="min-w-0 max-w-full text-xs font-normal opacity-80">{card.condition}</span>}
        <span className="min-w-0 max-w-full text-xs font-normal opacity-80">
          {deadlineLine("use", card.validUntil, nowMs)}
        </span>
        {!usable && reason && <span className="min-w-0 max-w-full text-xs font-normal">{reason}</span>}
      </span>
      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </button>
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
    <div className="flex flex-col gap-1.5">
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
    <div data-ui="pos-bill-card" className={POS_BILL_ROW_CLASS}>
      <span className={POS_BILL_LABEL_CLASS}>
        <span className="min-w-0 truncate">Scratch card: {offer.card.label}</span>
        <button
          type="button"
          className={cn(POS_BILL_LINK_CLASS, BRAND_PRESS_CLASS)}
          onClick={onClear}
          disabled={disabled}
          aria-label="Remove scratch card"
        >
          Remove
        </button>
      </span>
    </div>
  );
}
