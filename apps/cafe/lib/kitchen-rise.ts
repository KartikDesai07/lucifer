// The Kitchen cards' rise (U4 Task 4, 2026-10-30; design 6.3 Motion, values 7: the HTML's `rise .35s` on every card): when
// a card rises. A card rises on the answer that brings it — the first paint, a newly fired order, a card back on the board
// by the lost-ticket rule — and never on a filter change (values 10 #4 not copied: the HTML replays it there). The board
// body keeps this record in a ref, fed by EVERY card of each answer (before the header's filter, so a filter never makes
// a card new), and spends it once that answer's render is on screen, so a card that a later filter change mounts is told
// no. The card fixes what it was told when it mounts (components/kitchen/KitchenOrderCard.tsx). Client-safe: no React.
import type { KitchenOrderCard } from "@/lib/kitchen-cards";

export interface KitchenRise {
  /** The answer this record was made from (its cards array: a new array is a new answer, the same one is a re-render). */
  answer: readonly KitchenOrderCard[] | undefined;
  /** Every card id of that answer. */
  seen: ReadonlySet<string>;
  /** The ids that rise with it: not in the answer before. Empty once spent. */
  rising: ReadonlySet<string>;
}

export const KITCHEN_RISE_NONE: KitchenRise = { answer: undefined, seen: new Set(), rising: new Set() };

/** The record after `answer`: the same record for the same answer (a re-render, StrictMode's second pass) or no answer
 *  yet; else the answer's ids, rising those the answer before did not hold. */
export function kitchenRiseOf(record: KitchenRise, answer: readonly KitchenOrderCard[] | undefined): KitchenRise {
  if (answer === undefined || answer === record.answer) return record;
  const seen = new Set(answer.map((card) => card.orderId));
  return { answer, seen, rising: new Set([...seen].filter((id) => !record.seen.has(id))) };
}

/** The record once its answer's render is on screen: nothing more rises until the next answer. */
export function kitchenRiseSpent(record: KitchenRise): KitchenRise {
  return record.rising.size === 0 ? record : { ...record, rising: new Set() };
}
