// The Kitchen header's rules as pure functions (U4 Task 2, 2026-10-30; owner Q2 / Q3; design 6.1, 6.2, 6.4, 6.5 and 11 in
// docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md; values 2.3, 9.3): the type filter (All · Tables ·
// Walk-In), the second line ("{n} active orders · average wait {m} min · Updated just now"; below 720px
// "{n} active orders · avg wait {m} min", owner Q11), the time words the card's pill shares, and the refresh strip's rule
// (stale and the board's query failed or paused, final review I1). No React, no fetching: the filter, the counts, the
// average and the freshness all come from the payload the page already loads (no new request).
// lib/kitchen-header.test.ts pins every row.
import { updatedLabel } from "@/lib/floor-tiles";
import { KITCHEN_STALE_MS } from "@/lib/kitchen-board";
import type { KitchenOrderCard } from "@/lib/kitchen-cards";

/** The header's type filter (owner Q2): every card, the table cards, or the cards with no table. */
export type KitchenFilter = "all" | "tables" | "walkin";

/** The filter's tabs, in order: U1's Open orders words (the HTML's Dine-in / Takeaway / Delivery are not our order types). */
export const KITCHEN_FILTERS: readonly { key: KitchenFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "tables", label: "Tables" },
  { key: "walkin", label: "Walk-In" },
];

/** The server's label for an order with no table (lib/kitchen-board.ts buildKitchenRows: `order.tableNo ?? "Walk-In"`). */
const NO_TABLE_LABEL = "Walk-In";

/** Which tab a card counts under: a parcel, whatever its table, and a card with no table (a walk-in, a token order) are
 *  Walk-In (owner Q2; ruling K4: a parcel order is a Parcel card, today's card and U2's orderTitle); the other cards at a
 *  table are Tables (their code is the table's name, design 6.3; lib/kitchen-view.ts reads this same rule). */
export function kitchenFilterOf(card: Pick<KitchenOrderCard, "tableLabel" | "parcel">): Exclude<KitchenFilter, "all"> {
  return card.parcel || card.tableLabel === NO_TABLE_LABEL ? "walkin" : "tables";
}

/** The cards the board shows under a filter, in the board's own order (oldest first). All returns the board itself. */
export function filterCards(cards: KitchenOrderCard[], filter: KitchenFilter): KitchenOrderCard[] {
  return filter === "all" ? cards : cards.filter((card) => kitchenFilterOf(card) === filter);
}

const MINUTE_MS = 60_000;
const MINUTES_PER_HOUR = 60;

/** The average wait (values 9.3, the HTML's formula): the mean of the cards' exact ages from `cardFiredAt` (the age each
 *  card's pill shows; a card "fired in the future" by a device clock behind the server counts as 0, as its pill does),
 *  then rounded to whole minutes. null with no card. */
export function averageWaitMinutes(cards: readonly Pick<KitchenOrderCard, "cardFiredAt">[], nowMs: number): number | null {
  if (cards.length === 0) return null;
  const totalMs = cards.reduce((sum, card) => sum + Math.max(0, nowMs - Date.parse(card.cardFiredAt)), 0);
  return Math.round(totalMs / cards.length / MINUTE_MS);
}

/** The Kitchen's time words (design 6.4), for the card's pill and the average: whole minutes, "Now" under a minute (the
 *  HTML's; the pill only: the average reads "0 min" there, ruling K3), "{m} min" under an hour, then U3's hour form
 *  "{h}h {m}m" (the HTML's "135 min" has none, values 10 #24). */
export function kitchenAgeWords(minutes: number): string {
  const whole = Math.floor(minutes);
  if (!(whole >= 1)) return "Now";
  if (whole < MINUTES_PER_HOUR) return `${whole} min`;
  return `${Math.floor(whole / MINUTES_PER_HOUR)}h ${whole % MINUTES_PER_HOUR}m`;
}

/** The header's second line (owner Q3, design 6.2): the cards shown (after the filter; the HTML counts the whole board,
 *  values 10 #6, not copied), "1 active order" for one, their average wait (left out with no card; under a minute
 *  "0 min", the HTML's own words for an average of 0, values 2.3, ruling K3: "average wait Now" is no duration), then
 *  U3's freshness words once there is a good answer. One line, cut with an ellipsis by the header when narrow. Below
 *  720px (`phone`, owner Q11): "{n} active order(s) · avg wait {m}", no freshness part, so it fits the phone's title
 *  block (the strip is the failure signal there, as in the HTML's phone line). */
export function kitchenHeaderLine(input: { cards: readonly KitchenOrderCard[]; updatedAtMs: number; nowMs: number; phone: boolean }): string {
  const n = input.cards.length;
  const parts = [`${n} active ${n === 1 ? "order" : "orders"}`];
  const average = averageWaitMinutes(input.cards, input.nowMs);
  if (average !== null) parts.push(`${input.phone ? "avg wait" : "average wait"} ${average < 1 ? "0 min" : kitchenAgeWords(average)}`);
  if (!input.phone && input.updatedAtMs > 0) parts.push(updatedLabel(input.updatedAtMs, input.nowMs));
  return parts.join(" · ");
}

/** The last good answer is at least KITCHEN_STALE_MS old on the page's clock (design 6.2: today's Stale rule). Never
 *  before a first answer (dataUpdatedAt 0): a failed first load is the error screen. */
export function kitchenStale(updatedAtMs: number, nowMs: number): boolean {
  return updatedAtMs > 0 && nowMs - updatedAtMs >= KITCHEN_STALE_MS;
}

/** The refresh strip's rule (design 6.2, Review Focus 5; final review I1): the answer is stale AND the board's query has
 *  failed (a failed poll keeps status "error" with its data until a success) or is paused (an offline device), so both
 *  show it at 60–90s. A healthy or in-flight refetch never does: a return from the cache (the answer 60s+ old until the
 *  mount refetch lands) and a throttled background tab's polls are no failure. */
export function kitchenStripShows(input: { updatedAtMs: number; nowMs: number; isError: boolean; isPaused: boolean }): boolean {
  return kitchenStale(input.updatedAtMs, input.nowMs) && (input.isError || input.isPaused);
}

/** The filtered-empty box's words (design 6.5: the HTML's "No tickets here" in our unit). */
export const KITCHEN_EMPTY_FILTER_TEXT = "No orders here";
