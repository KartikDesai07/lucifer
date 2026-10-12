"use client";

import { Check, Gift } from "lucide-react";

import { cn } from "@/lib/utils";
import { PUB_PRESS_CLASS, PUB_SECTION_TITLE_CLASS } from "@/components/public/public-ui";
import { deadlineLine } from "@/components/public/rewards/reward-clock";
import { useDinerCards } from "@/components/public/rewards/use-diner-cards";
import { usableCards } from "@/components/public/rewards/usable-cards";
import { CART_CARDS_HEADING } from "@pos/shared/public-diner-cards";

// CB-7 S5 — the diner's revealed scratch cards, as tappable rows in the cart. One tap picks a card for THIS order, a
// second tap on the same row lets it go. The pick is only an INTENT (the card's id): the cafe checks and prices it
// when it accepts the order. Reads the wallet the Rewards tab already caches (no new fetch); renders nothing when
// there is no usable card, no wallet yet, or no signed-in diner.
const ROW_CLASS =
  "flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:opacity-50";

interface PublicCardPickerProps {
  // The signed-in diner's mobile (the wallet's cache key); null = signed out or cards off.
  identity: string | null;
  selectedId: string | null;
  // `null` = the diner let the card go.
  onSelect: (cardId: string | null) => void;
  disabled?: boolean;
}

export function PublicCardPicker({ identity, selectedId, onSelect, disabled = false }: PublicCardPickerProps) {
  const { data } = useDinerCards(identity);
  const cards = usableCards(data?.cards ?? []);
  if (cards.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className={PUB_SECTION_TITLE_CLASS}>{CART_CARDS_HEADING}</p>
      {cards.map((card) => {
        const selected = card.id === selectedId;
        return (
          <button
            key={card.id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onSelect(selected ? null : card.id)}
            className={cn(ROW_CLASS, PUB_PRESS_CLASS, selected ? "border-primary bg-primary/10" : "bg-card")}
          >
            {selected ? (
              <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            ) : (
              <Gift className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-medium">{card.outcome.label}</span>
              {card.outcome.condition !== null && (
                <span className="block break-words text-xs text-muted-foreground">{card.outcome.condition}</span>
              )}
              {card.validUntil !== undefined && (
                <span className="block text-xs text-muted-foreground">
                  {deadlineLine("use", card.validUntil, Date.now())}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
