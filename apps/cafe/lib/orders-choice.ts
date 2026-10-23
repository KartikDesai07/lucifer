// The Orders page's chosen order as a pure model (U2 Task 5, 2026-10-23; docs/superpowers/specs/
// 2026-10-23-orders-match-html-design.md 6.6, rulings P9 and P11, Review Focus 2). From 1280px the detail column always
// shows an order: with nothing chosen it takes the first row shown (the HTML's), once — a list refresh or a new order
// arriving never swaps it; it changes when the operator taps a row, or makes a filter edit (the lane, the date, the
// payment, the table, a chip, Clear all / Reset) or a keystroke in the phone search, which drops the choice so the next
// first row is taken. The key is the TYPED phone, never the debounced one (ruling P11): the search landing 350ms after
// the last keystroke must not swap or close a detail, nor the payment opened from it. Below 1280px nothing is chosen
// until a row is tapped, and a first row the column took on its own gives way when the window drops below 1280px
// (ruling P9: a tablet turned from 1280 to portrait does not pop the full-screen sheet open), while a tapped order stays
// chosen across the line. app/(dashboard)/orders/page.tsx settles the choice during render with settleChoice and stores
// it only when it changes, so no frame ever shows a stale or a popped-open choice. Client-safe: no React.
import type { Order } from "@/types";

export interface OrdersChoice {
  /** The order the detail shows; null: none. */
  order: Order | null;
  /** The column took it on its own (the first row shown), not the operator (ruling P9). */
  auto: boolean;
  /** The choice key it was made under (choiceKey): a different key drops it. */
  key: string;
}

/** The choice key (ruling P11): the page's count of filter edits and the phone as TYPED (trimmed). A keystroke or an edit
 *  changes it; the debounced phone landing in the filters does not. */
export function choiceKey(filterEdits: number, typedPhone: string): string {
  return `${filterEdits}|${typedPhone.trim()}`;
}

/** Nothing chosen under this key. */
export function noChoice(key: string): OrdersChoice {
  return { order: null, auto: false, key };
}

/** The operator's choice: a tapped row, the strip's "Settle {code}", or the fresher order a settle or a move hands back
 *  (null: the detail closed), under the latest key. */
export function tappedChoice(order: Order | null, key: string): OrdersChoice {
  return { order, auto: false, key };
}

/**
 * The choice for this render: dropped when the key changed; an empty one takes `first` (the first row shown; undefined
 * while the list has not answered) from 1280px only (`xl` true; null = the width not known yet); an auto-picked one is
 * cleared below 1280px. Returns the SAME object when nothing changes, and a settled choice settles to itself, so the page
 * stores it only on a change.
 */
export function settleChoice(choice: OrdersChoice, key: string, xl: boolean | null, first: Order | undefined): OrdersChoice {
  const held = choice.key === key ? choice : noChoice(key);
  if (held.order === null) return xl === true && first ? { order: first, auto: true, key } : held;
  return held.auto && xl === false ? noChoice(key) : held;
}

/** A press or focus inside the detail, or in a sheet it opened (the payment, the move), makes an auto-picked order the
 *  operator's (Review Focus 2): the payment opened from it is never taken away when the window drops below 1280px. The
 *  same object when there is nothing to change. */
export function engageChoice(choice: OrdersChoice): OrdersChoice {
  return choice.auto ? { ...choice, auto: false } : choice;
}
