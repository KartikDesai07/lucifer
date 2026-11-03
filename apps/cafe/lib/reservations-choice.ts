// The Reservations page's chosen booking as a pure model (U6 Task 3, 2026-11-03; design B5): U2's lib/orders-choice.ts on
// booking ids. From 1280px the detail column always shows a booking: with nothing chosen it takes the first row shown (the
// HTML's), once — a list refresh never swaps it; it changes when the operator presses a row, or makes a filter edit (the
// day, Today, a calendar pick, the status select) or a keystroke in the search, which drops the choice so the next first row
// is taken. Below 1280px nothing is chosen until a row is pressed, and a first row the column took on its own gives way when
// the window drops below 1280px (a tablet turned from 1280 to portrait does not pop the full-screen sheet open), while a
// pressed booking stays chosen across the line. The page settles the choice during render with settleResChoice and stores it
// only when it changes. The detail reads the LIVE booking by id from the whole list, so a booking that leaves the shown tab
// after Seat stays on screen. Client-safe: no React.

export interface ResChoice {
  /** The booking the detail shows; null: none. */
  id: string | null;
  /** The column took it on its own (the first row shown), not the operator. */
  auto: boolean;
  /** The key it was made under (resChoiceKey): a different key drops it. */
  key: string;
}

/** The choice key: the page's count of filter edits and the search as TYPED (trimmed). */
export function resChoiceKey(filterEdits: number, typedQuery: string): string {
  return `${filterEdits}|${typedQuery.trim()}`;
}

/** Nothing chosen under this key. */
export function noResChoice(key: string): ResChoice {
  return { id: null, auto: false, key };
}

/** The operator's choice: a pressed row (null: the detail closed), under the latest key. */
export function tappedResChoice(id: string | null, key: string): ResChoice {
  return { id, auto: false, key };
}

/**
 * The choice for this render: dropped when the key changed; an empty one takes `firstId` (the first row shown; undefined
 * while the list has not answered or is empty) from 1280px only (`xl` true; null = the width not known yet); an auto-picked
 * one is cleared below 1280px. Returns the SAME object when nothing changes, and a settled choice settles to itself.
 */
export function settleResChoice(choice: ResChoice, key: string, xl: boolean | null, firstId: string | undefined): ResChoice {
  const held = choice.key === key ? choice : noResChoice(key);
  if (held.id === null) return xl === true && firstId !== undefined ? { id: firstId, auto: true, key } : held;
  return held.auto && xl === false ? noResChoice(key) : held;
}

/** A press or focus inside the detail, or in a dialog it opened, makes an auto-picked booking the operator's. The same
 *  object when there is nothing to change. */
export function engageResChoice(choice: ResChoice): ResChoice {
  return choice.auto ? { ...choice, auto: false } : choice;
}
