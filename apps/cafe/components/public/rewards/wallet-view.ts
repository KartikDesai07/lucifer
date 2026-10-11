import type { DinerCardDto, DinerCardsData, DinerReadyCardDto } from "@pos/shared/public-diner-cards";

// CB-7 S4 — small pure views over the wallet the components share.

// The card list with the OPEN scratch sheet's card held at its ready snapshot: the scratch answer refreshes the
// cache (the card turns revealed, or a no-reward card turns used and leaves the Active grid) while the diner is still
// wiping the foil, and the grid behind the sheet must not give the result away or reshuffle. `openCard` is null once
// the sheet is closed, so the cache shows as is.
export function freezeOpenCard(cards: readonly DinerCardDto[], openCard: DinerReadyCardDto | null): readonly DinerCardDto[] {
  if (openCard === null) return cards;
  return cards.map((card) => (card.id === openCard.id ? openCard : card));
}

// "N cards to scratch": ready (not expired) cards, and only while the cafe is earning — a paused cafe cannot be
// scratched, so the Home chip must not promise it.
export function scratchableCount(data: Pick<DinerCardsData, "earning" | "cards">): number {
  return data.earning ? data.cards.filter((card) => card.state === "ready").length : 0;
}
