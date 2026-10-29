// What one Floor tile shows (U3 Task 3, 2026-10-28): the owner's HTML tile with our data folded in (owner Q2; design
// 6.5 in docs/superpowers/specs/2026-10-28-floor-match-html-design.md, values 4.1-4.3 in
// docs/superpowers/specs/2026-10-28-floor-html-values.md). Its tone and word are the pill it counts in (floorFilterOf:
// "Bill printed" only when the server knows of the print, U2 Q11), its one detail line follows today's kinds K1-K10 (the
// tap rules stay lib/floor-tiles.ts's), and its accessible name says what a tap does now that the action word is gone.
// Pure: no React, no fetching; lib/floor-view.test.ts pins every row. The tones live here, never in TABLE_STATUS_META,
// which Setup and the dashboard read.
import { FLOOR_FILTER_DOT } from "@/lib/floor-layout";
import { FLOOR_FILTERS, FLOOR_TAP_HINT, floorFilterOf, formatStayMinutes, formatStayMinutesShort, type FloorTileModel } from "@/lib/floor-tiles";
import { tableChargeOf } from "@/lib/receipt";
import { seatsText } from "@/lib/table-sheet";
import { formatTime, inr } from "@/lib/utils";

/** The HTML's four tile looks (values 4.2), keyed as the pills (no "KOT pending": we have no such state, design 7). */
export type FloorTone = "free" | "occupied" | "billed" | "reserved";

/** Each look from U0 tokens (values 4.2): the surface's border + background, the dot, the status word's ink. Free is the
 *  HTML's plain white tile; the dots are the pills' (ruling F2). */
export const FLOOR_TILE_TONES: Record<FloorTone, { tile: string; dot: string; label: string }> = {
  free: { tile: "border-border bg-card", dot: FLOOR_FILTER_DOT.free, label: "text-status-ok-ink" },
  occupied: { tile: "border-status-info-border bg-status-info-tint", dot: FLOOR_FILTER_DOT.occupied, label: "text-status-info-ink" },
  billed: { tile: "border-status-bill-border bg-status-bill-tint", dot: FLOOR_FILTER_DOT.billed, label: "text-status-bill-ink" },
  reserved: { tile: "border-status-reserved-border bg-status-reserved-tint", dot: FLOOR_FILTER_DOT.reserved, label: "text-status-reserved-ink" },
};

/** The tile's one detail line (design 6.5): a bill and its stay, words (with a shorter phone form), the table charge, or a
 *  loading bar. The stay has a phone form too (the owner's answer 2026-10-28): `phoneStay` below 720px ("72m"), `stay`
 *  from 720px. The charge keeps its label and amount apart, so only the label is cut (the owner's Q7). */
export type FloorDetail =
  | { kind: "money"; amount: string; stay: string; phoneStay: string }
  | { kind: "text"; text: string; phoneText?: string }
  | { kind: "charge"; label: string; amount: string }
  | { kind: "skeleton" };

export interface FloorTileView {
  tone: FloorTone;
  /** The status word: the pill's word for the tone ("Available", "Occupied", "Bill printed", "Reserved"). */
  label: string;
  detail: FloorDetail;
  /** "1 seat" / "4 seats" (the top row's right end). */
  seats: string;
  /** The bill has been open past the cafe's long-stay setting (today's rule): the stay turns red. */
  longStay: boolean;
  /** "{tableNo}, {seats}, {word}, {detail}[, long stay][ — {what a tap does}]" (the seats: ruling F10). */
  accessibleName: string;
}

const NO_BILL_TEXT = "No open bill";
const BILL_FAILED_TEXT = "Bill not loaded";
const HELD_TEXT = "Held";
/** The HTML's free-tile line, and the phone's shorter one (design 8 #1: "Tap to seat gu…" is not copied). */
const SEAT_TEXT = "Tap to seat guests";
const SEAT_PHONE_TEXT = "Tap to seat";
const LONG_STAY_WORDS = "long stay";
/** The stay before the clock exists or on a bad date ("—"): the accessible name leaves it out (logic-4). */
const NO_STAY = formatStayMinutes(null);

function toneLabel(tone: FloorTone): string {
  return FLOOR_FILTERS.find((f) => f.key === tone)?.label ?? tone;
}

// Design 6.5's table, today's kinds: a Reserved table shows its booking or "Held" (K8-K10, a bill on it included); any
// other table with a bill shows the money (K1, K7); an Occupied one without shows what is known of its bills (K2-K4); an
// Available one its table charge or the HTML's line (K5, K6).
function detailOf(tile: FloorTileModel, tabsFailed: boolean): FloorDetail {
  const { table, tab, reservation } = tile;
  if (table.status === "Reserved") {
    return { kind: "text", text: reservation ? `${formatTime(reservation.time)} · ${reservation.name}` : HELD_TEXT };
  }
  if (tab) {
    const m = tile.minutesOpen;
    return { kind: "money", amount: inr(tab.total), stay: formatStayMinutes(m), phoneStay: formatStayMinutesShort(m) };
  }
  if (table.status === "Occupied") {
    if (tile.tabsKnown) return { kind: "text", text: NO_BILL_TEXT };
    return tabsFailed ? { kind: "text", text: BILL_FAILED_TEXT } : { kind: "skeleton" };
  }
  const charge = tableChargeOf(table);
  if (charge.amount > 0) return { kind: "charge", label: charge.label, amount: inr(charge.amount) };
  return { kind: "text", text: SEAT_TEXT, phoneText: SEAT_PHONE_TEXT };
}

function detailWords(detail: FloorDetail): string | null {
  switch (detail.kind) {
    case "money":
      return detail.stay === NO_STAY ? detail.amount : `${detail.amount}, ${detail.stay}`;
    case "text":
      return detail.text;
    case "charge":
      return `${detail.label} ${detail.amount}`;
    case "skeleton":
      return null;
  }
}

/** One tile's look and words. `tabsFailed`: the open bills failed to load with no older list to show. */
export function floorTileView(tile: FloorTileModel, tabsFailed: boolean): FloorTileView {
  const tone = floorFilterOf(tile);
  const label = toneLabel(tone);
  const detail = detailOf(tile, tabsFailed);
  const words = detailWords(detail);
  const seats = seatsText(tile.table.capacity);
  const hint = FLOOR_TAP_HINT[tile.primary];
  // Ruling F10: the seats after the name, as today's surface and U1's table picker announce them.
  let accessibleName = [tile.table.tableNo, seats, label, ...(words ? [words] : []), ...(tile.longStay ? [LONG_STAY_WORDS] : [])].join(", ");
  if (hint) accessibleName += ` — ${hint}`;
  return { tone, label, detail, seats, longStay: tile.longStay, accessibleName };
}
