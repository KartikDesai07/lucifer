// The Kitchen card's words as a pure model (U4 Task 3, 2026-10-30; owner Q5 / Q6 / Q9; design 6.3, 6.4, 6.6 and 11 in
// docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md; values 4.1-4.5 in
// docs/superpowers/specs/2026-10-29-kitchen-html-values.md): the code, the where line, the time pill, the late border, the
// footer and the Mark ready button, as components/kitchen/KitchenOrderCard.tsx draws them. Everything comes from the card the
// payload already carries (no new request). Client-safe: no Mongoose, no React. lib/kitchen-view.test.ts pins every row.
import { kitchenAgeBand, type KitchenAgeBand } from "@/lib/kitchen-board";
import type { KitchenOrderCard } from "@/lib/kitchen-cards";
import { kitchenAgeWords, kitchenFilterOf } from "@/lib/kitchen-header";
import { clockTime, orderNumberOf } from "@/lib/orders-row";
import { tokenLabelOf } from "@/lib/token-view";

/** The pill's band (today's `kitchenAgeBand`: under 10 / 10-19 / from 20 minutes, the HTML's thresholds). */
export type KitchenBand = KitchenAgeBand["key"];

const MINUTE_MS = 60_000;
/** Today's title on an age fired before age tracking (kept, design 6.3). */
const APPROX_TITLE = "approximate — fired before age tracking";

/** The card's token label when the order has one (tokens on: the server adds `tokenNumber`), else false. */
function tokenOf(card: Pick<KitchenOrderCard, "tokenNumber">): string | false {
  return card.tokenNumber !== undefined && tokenLabelOf(card.tokenNumber);
}

const atTable = (card: Pick<KitchenOrderCard, "tableLabel">): boolean => kitchenFilterOf(card) === "tables";

/** The big code (design 6.3, Q9): a table card its table's name ("T-4"); a card with no table its token ("Token 12") when
 *  it has one, else "Parcel" for a parcel order and "Walk-In" for the rest. The Ready toast names the card by it. */
export function kitchenCardCode(card: KitchenOrderCard): string {
  if (atTable(card)) return card.tableLabel;
  return tokenOf(card) || (card.parcel ? "Parcel" : "Walk-In");
}

/** The where line (design 6.3): "{type} · Order #{n}[ · Token {t}][ · Self-order]". The type is "Table" on a table card;
 *  with no table, "Parcel" / "Walk-In" when the code is the token, and nothing when the code already says it. The token
 *  only on a table card (elsewhere it is the code); "Self-order" once per card. */
export function kitchenWhereLine(card: KitchenOrderCard): string {
  const table = atTable(card);
  const token = tokenOf(card);
  const type = table ? "Table" : token ? (card.parcel ? "Parcel" : "Walk-In") : false;
  return [type, `Order ${orderNumberOf(card.orderNo)}`, table && token, card.selfOrder && "Self-order"].filter(Boolean).join(" · ");
}

export interface KitchenPill {
  /** "Now", "{m} min", "{h}h {m}m" (design 6.4), "~" first when approximate. */
  text: string;
  band: KitchenBand;
  /** Today's title on an approximate age. */
  title?: string;
  /** " Late" read to screen readers (the red pill and border say it on screen). */
  srLate: boolean;
}

/** The time pill (design 6.3 / 6.4; values 4.4): the card's age from `cardFiredAt` in whole minutes (floored; a card
 *  "fired in the future" by a device clock behind the server reads "Now"), its band, and today's "~" and title. */
export function kitchenPill(card: KitchenOrderCard, nowMs: number): KitchenPill {
  const band = kitchenAgeBand(card.cardFiredAt, new Date(nowMs)).key;
  const words = kitchenAgeWords((nowMs - Date.parse(card.cardFiredAt)) / MINUTE_MS);
  return {
    text: `${card.cardFiredAtApprox ? "~" : ""}${words}`,
    band,
    ...(card.cardFiredAtApprox ? { title: APPROX_TITLE } : {}),
    srLate: band === "late",
  };
}

/** The red border (design 6.3): late and not every line ticked (the HTML's "late and not in Ready", Ready read as every
 *  line ticked; the pill stays red). */
export function kitchenCardLate(card: KitchenOrderCard, nowMs: number): boolean {
  return kitchenAgeBand(card.cardFiredAt, new Date(nowMs)).key === "late" && !card.allDone;
}

/** The footer (design 6.3): left "KOT #9, #12 · 9:26 PM" (the card's ticket numbers, the first round's fire time in the
 *  cafe's time zone, "~" first when that round is approximate), "Sent 9:26 PM" with ticket numbers off; right the HTML's
 *  "{d} of {n} done". */
export function kitchenFooter(card: KitchenOrderCard): { left: string; right: string } {
  const first = card.lines.reduce<KitchenOrderCard["lines"][number] | undefined>((min, l) => (min && min.round <= l.round ? min : l), undefined);
  const at = first ? first.firedAt : card.cardFiredAt;
  const approx = first ? first.firedAtApprox : card.cardFiredAtApprox;
  const time = `${approx ? "~" : ""}${clockTime(at)}`;
  const kot = card.ticketNumbers.map((n) => `#${n}`).join(", ");
  return { left: kot ? `KOT ${kot} · ${time}` : `Sent ${time}`, right: `${card.doneCount} of ${card.totalCount} done` };
}

/** The Mark ready button (Q5): lines still open, ink "Mark ready · {n} not ticked" (the nudge stays, the button never
 *  blocks: P12); every line ticked, the green "Mark ready". */
export function kitchenButton(card: KitchenOrderCard): { label: string; kind: "open" | "done" } {
  if (card.allDone) return { label: "Mark ready", kind: "done" };
  return { label: `Mark ready · ${card.totalCount - card.doneCount} not ticked`, kind: "open" };
}
