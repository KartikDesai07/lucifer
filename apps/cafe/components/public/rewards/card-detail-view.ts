import { deadlineLine } from "@/components/public/rewards/reward-clock";
import { POINTS_EXPIRE_RULE } from "@pos/shared/reward-points";
import {
  CARD_TERMS,
  POINTS_RULE,
  everyCardWins,
  type DinerPoolChoice,
  type DinerRevealedCardDto,
} from "@pos/shared/public-diner-cards";

// CB-7 S6 — what the revealed-card detail sheet shows, derived from the wallet's own card (no fetch, no new data).
// PURE: `now` is passed in so the "Use by" line is testable.

export interface CardDetailView {
  title: string;
  condition: string | null;
  // "N points left" — only on a points card (same wording as the wallet tile).
  pointsLeft: string | null;
  useBy: string | null;
  chances: DinerPoolChoice[];
  everyCardWins: boolean;
  terms: string[];
}

export function cardDetailView(card: DinerRevealedCardDto, now: number): CardDetailView {
  const { outcome } = card;
  return {
    title: outcome.label,
    condition: outcome.condition,
    pointsLeft: outcome.pointsLeft !== undefined ? `${outcome.pointsLeft} points left` : null,
    useBy: card.validUntil !== undefined ? deadlineLine("use", card.validUntil, now) : null,
    chances: card.pool,
    everyCardWins: everyCardWins(card.pool.map((choice) => choice.kind)),
    terms: outcome.kind === "points" ? [CARD_TERMS, POINTS_RULE, POINTS_EXPIRE_RULE] : [CARD_TERMS],
  };
}
