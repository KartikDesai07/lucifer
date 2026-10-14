"use client";

import { useState } from "react";
import { Check, ChevronDown, Clock, Gift, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  PUB_CHIP_CLASS,
  PUB_PRESS_CLASS,
  PUB_SECTION_HEADING_CLASS,
  PUB_TONAL_CARD_CLASS,
} from "@/components/public/public-ui";
import { PUBLIC_TOUCH_TARGET_CLASS } from "@/components/public/public-shell-layout";
import { PublicCardDetailSheet } from "@/components/public/rewards/PublicCardDetailSheet";
import { PublicScratchSheet } from "@/components/public/rewards/PublicScratchSheet";
import { freezeOpenCard } from "@/components/public/rewards/wallet-view";
import { deadlineLine } from "@/components/public/rewards/reward-clock";
import {
  CARD_STATE_WORDS,
  SCRATCH_PAUSED,
  type DinerCardDto,
  type DinerReadyCardDto,
  type DinerRevealedCardDto,
} from "@pos/shared/public-diner-cards";

// CB-7 S4 — the scratch-card wallet as a two-column grid of square tiles (Google Pay style). One status signal per
// tile: a READY card is a brand-colour foil tile with a light pattern of glyphs; a REVEALED card is a quiet tonal tile
// with the reward in large type; a used or expired card sits in a collapsed "Past cards" list with its state word.
// `part` picks which half of the wallet this instance draws — the Levels tab puts the active cards under the hero and
// the past cards at the very end.

const TILE_GRID_CLASS = "grid grid-cols-2 gap-3 sm:grid-cols-3";
const TILE_CLASS = "relative aspect-square w-full overflow-hidden rounded-2xl text-left";
const PATTERN_CELLS = 12;

interface PublicCardWalletProps {
  cards: readonly DinerCardDto[];
  earning: boolean;
  identity: string | null;
  part?: "active" | "history";
  // Called when this wallet's scratch sheet opens or closes — the Levels tab freezes the whole screen meanwhile.
  onSheetChange?: (open: boolean) => void;
}

function isActive(card: DinerCardDto): boolean {
  return card.state === "ready" || card.state === "revealed";
}

// The light glyph pattern over a ready tile (decorative only).
function FoilPattern() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid grid-cols-3 place-items-center gap-2 p-2">
      {Array.from({ length: PATTERN_CELLS }, (_, i) =>
        i % 2 === 0 ? (
          <Sparkles key={i} className="h-5 w-5 text-primary-foreground/15" />
        ) : (
          <Gift key={i} className="h-5 w-5 text-primary-foreground/15" />
        ),
      )}
    </div>
  );
}

function ReadyTile({ card, earning, onScratch }: { card: DinerReadyCardDto; earning: boolean; onScratch: () => void }) {
  if (!earning) {
    return (
      <div className={cn(TILE_CLASS, "flex flex-col justify-end bg-muted p-3 text-muted-foreground")}>
        <p className="text-sm font-medium">{CARD_STATE_WORDS.ready}</p>
        <p className="mt-1 text-xs">{SCRATCH_PAUSED}</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onScratch}
      aria-label={`${card.title ? `${card.title}. ` : ""}Scratch card. ${deadlineLine("scratch", card.scratchBy, Date.now())}`}
      className={cn(TILE_CLASS, PUB_PRESS_CLASS, "bg-primary text-primary-foreground")}
    >
      <FoilPattern />
      <span className="relative flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
        {card.title && <span className="line-clamp-2 block break-words text-xs font-medium text-primary-foreground/90">{card.title}</span>}
        <span className="font-pub-display text-xl font-semibold">Scratch</span>
        <span className="text-xs text-primary-foreground/80">{deadlineLine("scratch", card.scratchBy, Date.now())}</span>
      </span>
    </button>
  );
}

// A revealed tile opens the card's detail sheet (condition, chances, terms) — a button, so it is a real 44 px+ target.
function RevealedTile({ card, onOpen }: { card: DinerRevealedCardDto; onOpen: () => void }) {
  const { outcome } = card;
  const detail = outcome.pointsLeft !== undefined ? `${outcome.pointsLeft} points left` : outcome.condition;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`${card.title ? `${card.title}. ` : ""}${outcome.label}. See card details`}
      className={cn(TILE_CLASS, PUB_TONAL_CARD_CLASS, PUB_PRESS_CLASS, "flex flex-col justify-between gap-2 p-3")}
    >
      <span className="block min-w-0">
        {card.title && <span className="mb-0.5 line-clamp-1 block break-words text-xs font-medium text-muted-foreground">{card.title}</span>}
        <span className="line-clamp-2 block break-words font-pub-display text-xl font-semibold leading-tight">{outcome.label}</span>
      </span>
      <span className="block shrink-0 space-y-0.5 text-xs text-muted-foreground">
        {detail !== null && <span className="line-clamp-2 block">{detail}</span>}
        {card.validUntil !== undefined && <span className="block">{deadlineLine("use", card.validUntil, Date.now())}</span>}
      </span>
    </button>
  );
}

function PastTile({ card }: { card: DinerCardDto }) {
  const Icon = card.state === "used" ? Check : Clock;
  return (
    <div className="flex min-h-24 items-center rounded-2xl bg-muted p-3 text-muted-foreground">
      <span className={cn(PUB_CHIP_CLASS, "bg-background/60")}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {CARD_STATE_WORDS[card.state]}
      </span>
    </div>
  );
}

export function PublicCardWallet({ cards, earning, identity, part = "active", onSheetChange }: PublicCardWalletProps) {
  const [sheetCard, setSheetCard] = useState<DinerReadyCardDto | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailCard, setDetailCard] = useState<DinerRevealedCardDto | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

  function changeSheet(open: boolean): void {
    setSheetOpen(open);
    onSheetChange?.(open);
  }

  if (part === "history") {
    const past = cards.filter((card) => !isActive(card));
    if (past.length === 0) return null;
    return (
      <div>
        <button
          type="button"
          aria-expanded={pastOpen}
          onClick={() => setPastOpen((v) => !v)}
          className={cn("flex w-full items-center justify-between gap-2 text-left", PUBLIC_TOUCH_TARGET_CLASS)}
        >
          <span className="text-sm font-medium">Past cards ({past.length})</span>
          <ChevronDown className={cn("h-5 w-5 transition-transform", pastOpen && "rotate-180")} aria-hidden="true" />
        </button>
        {pastOpen && (
          <div className={cn(TILE_GRID_CLASS, "mt-2")}>
            {past.map((card) => (
              <PastTile key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // While the scratch sheet is open its card stays as the ready snapshot (the cache moves on at the server answer).
  const active = freezeOpenCard(cards, sheetOpen ? sheetCard : null).filter(isActive);
  if (active.length === 0 && !earning) return null;

  return (
    <div>
      <p className={PUB_SECTION_HEADING_CLASS}>Your scratch cards</p>
      {active.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No cards to scratch yet. Keep ordering and your next card will show up here.
        </p>
      ) : (
        <div className={cn(TILE_GRID_CLASS, "mt-3")}>
          {active.map((card) =>
            "outcome" in card ? (
              <RevealedTile key={card.id} card={card} onOpen={() => setDetailCard(card)} />
            ) : (
              <ReadyTile
                key={card.id}
                card={card}
                earning={earning}
                onScratch={() => {
                  setSheetCard(card);
                  changeSheet(true);
                }}
              />
            ),
          )}
        </div>
      )}
      <PublicScratchSheet card={sheetCard} open={sheetOpen} identity={identity} onOpenChange={changeSheet} />
      <PublicCardDetailSheet card={detailCard} open={detailCard !== null} onOpenChange={(open) => !open && setDetailCard(null)} />
    </div>
  );
}
