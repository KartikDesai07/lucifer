import { isCardUseKind } from "@pos/shared/reward-card-use";
import type { DinerCardDto, DinerRevealedCardDto } from "@pos/shared/public-diner-cards";

// CB-7 S5 — the cards a diner can put on THIS order from the cart: revealed (not used, not expired) AND of a kind
// that is spent as a discount on a bill (points lots and "no reward" cards are never offered). PURE; the server
// re-checks everything at claim, this only decides what to show.
export function usableCards(cards: readonly DinerCardDto[]): DinerRevealedCardDto[] {
  return cards.filter(
    (card): card is DinerRevealedCardDto =>
      card.status !== "ready" && card.state === "revealed" && isCardUseKind(card.outcome.kind),
  );
}
