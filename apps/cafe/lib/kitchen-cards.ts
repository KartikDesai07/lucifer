// TYPE-ONLY mongoose, same reason as kitchen-board.ts: this module is imported
// by "use client" components, and a VALUE import of the driver here would pull
// it into the client bundle (lib/client-graph-guard.test.ts fails on exactly
// that edge). `import type` erases at compile time.
import type { Types } from "mongoose";
import {
  buildKitchenRows,
  type KitchenOrderInput,
  type KitchenRow,
} from "@/lib/kitchen-board";

// P4-B — the kitchen board's ORDER-CARD view. Pure: no DB, no React, no fetch.
// The route hands it data it already fetched; the tests hand it fixtures.
//
// Why cards: a cook works an ORDER at a time ("table 5's food"), not a global
// list of lines. Grouping is what makes the board readable from across a
// kitchen, and it is what lets an order leave the board as ONE decision (the
// Ready tap) instead of silently evaporating line by line.

/** Cards on one board payload. This is the ONLY bound the card view applies —
 *  it deliberately opts out of KITCHEN_ROW_LIMIT (see buildKitchenCards),
 *  because a cap counted in LINES can cut an order in half and leave a card
 *  understating its own food, while a cap counted in CARDS can only drop whole
 *  orders. The real bound is OPEN_TAB_LIMIT (100) in the route, so like the row
 *  cap this guards a pathological fixture, not real service: 60 cards is ~15-20
 *  screens of wall display, far past what a kitchen can act on. Applied AFTER
 *  the FIFO sort, so it drops the NEWEST cards and never the oldest — the
 *  oldest is the work that actually matters. */
export const KITCHEN_CARD_LIMIT = 60;

/** One order's worth of fired work. `lines` are the same KitchenRow objects the
 *  line view used, verbatim — so POST /api/kitchen stays addressed by
 *  (orderId, ref) exactly as before and the tick contract is untouched. */
export interface KitchenOrderCard {
  orderId: string;
  orderNo: string;
  tableLabel: string;
  /** True when the order is a takeaway/parcel — the cook packs it rather than
   *  plating it, which is a different physical action and so must be a distinct
   *  channel on the card, never inferred from a missing table. */
  parcel: boolean;
  selfOrder: boolean;
  /** Printed ticket numbers across this card's rounds, in round order, for
   *  matching the paper slips in hand. Empty when the cafe prints no numbers. */
  ticketNumbers: number[];
  lines: KitchenRow[];
  doneCount: number;
  totalCount: number;
  allDone: boolean;
  /** Drives BOTH the card's FIFO position and its age band, so the badge can
   *  never contradict the position. See cardFiredAtOf. ISO string, not a Date:
   *  this crosses the wire (KitchenRow.firedAt's comment has the full reason). */
  cardFiredAt: string;
  cardFiredAtApprox: boolean;
  /** P4-C — the NEWEST fire instant on this card, i.e. the most recent round
   *  the cook could actually SEE when they looked at it. Distinct from
   *  cardFiredAt, which is the OLDEST unfinished line (the FIFO/age key) and
   *  would be far too early to use as a readiness bound. Sent with a Ready tap
   *  so the server stamps readyAt at what was seen rather than at `now`; a
   *  round fired since then stays newer than the stamp and the card returns.
   *  ISO string for the same wire reason as cardFiredAt. */
  newestFiredAt: string;
}

export interface BuildKitchenCardsInput {
  orders: KitchenOrderInput[];
  ticksByOrder: Record<string, string[]>;
  /** orderId -> when a cook marked it Ready. An order is hidden ONLY while this
   *  stamp is at least as new as its newest fired round — see buildKitchenCards. */
  readyAtByOrder?: Record<string, Date | string | undefined>;
}

/** The newest round-fire instant on an order, as ms. Falls back to createdAt for
 *  a tab fired before age tracking existed (kotFiredAt is `?`-optional and can
 *  be short — the /items route backfills positionally, but an old doc may carry
 *  nothing at all). */
function newestFiredAtMs(order: KitchenOrderInput): number {
  let newest = new Date(order.createdAt).getTime();
  for (const stamp of order.kotFiredAt ?? []) {
    const ms = new Date(stamp).getTime();
    if (Number.isFinite(ms) && ms > newest) newest = ms;
  }
  return newest;
}

/**
 * Is this order hidden by a cook's Ready tap?
 *
 * THE LOST-TICKET RULE. A Ready'd tab is usually still open (status Pending,
 * payment Unpaid — the board's own filter), so staff can fire ANOTHER round on
 * it minutes later. A plain "hasReadyAt" flag would hide that new round
 * forever: the card never returns, the food is never cooked, and nothing
 * anywhere reports it. So readiness is not a boolean — it is a COMPARISON.
 * The stamp only suppresses the work it could actually have seen, and any round
 * fired after it brings the card straight back.
 *
 * Deliberately `>=` on the ready side: a round fired in the same millisecond as
 * the tap is treated as already-seen. That direction is the safe one to round —
 * the alternative would resurrect a card the cook just cleared on every
 * same-instant tie, and the round is still visible on the printed slip.
 */
function isHiddenByReady(order: KitchenOrderInput, readyAt: Date | string | undefined): boolean {
  if (!readyAt) return false;
  const readyMs = new Date(readyAt).getTime();
  if (!Number.isFinite(readyMs)) return false; // unparseable stamp never hides work
  return readyMs >= newestFiredAtMs(order);
}

/**
 * The instant that places the card in the queue and colours its age.
 *
 * It is the OLDEST line still to be cooked — that is the work the kitchen is
 * actually behind on. Once every line is ticked (the card is waiting for its
 * Ready tap) there is no unfinished line to read, so it falls back to the
 * oldest line overall; without that fallback an all-done card would jump to the
 * end of the queue at the exact moment a cook is looking for it.
 */
function cardFiredAtOf(lines: KitchenRow[]): { at: string; approx: boolean } {
  const pending = lines.filter((line) => !line.done);
  const pool = pending.length > 0 ? pending : lines;
  // ISO-8601 UTC, fixed width, always `Z` — so a lexicographic compare IS the
  // chronological compare (same justification as buildKitchenRows' sort).
  let oldest = pool[0];
  for (const line of pool) {
    if (line.firedAt.localeCompare(oldest.firedAt) < 0) oldest = line;
  }
  return { at: oldest.firedAt, approx: oldest.firedAtApprox };
}

/**
 * Group fired lines into per-order cards, oldest first.
 *
 * An order leaves the board only by being marked Ready (and only while that
 * stamp still covers its newest round — see isHiddenByReady). Ticking every
 * line does NOT remove the card: it flips `allDone`, which is what surfaces the
 * Ready button.
 */
export function buildKitchenCards({
  orders,
  ticksByOrder,
  readyAtByOrder = {},
}: BuildKitchenCardsInput): KitchenOrderCard[] {
  // capRows:false — the row cap would cut at an arbitrary line boundary, which
  // for a CARD means silently truncating one order's lines and showing a
  // `totalCount` lower than the food that was actually fired. A card must never
  // understate its own order. The bound is applied per-CARD below instead,
  // where it can only ever drop whole orders.
  const rows = buildKitchenRows({ orders, ticksByOrder, capRows: false });
  const linesByOrder = new Map<string, KitchenRow[]>();
  for (const row of rows) {
    const bucket = linesByOrder.get(row.orderId);
    if (bucket) bucket.push(row);
    else linesByOrder.set(row.orderId, [row]);
  }

  const cards: KitchenOrderCard[] = [];
  for (const order of orders) {
    const orderId = String(order._id);
    const lines = linesByOrder.get(orderId);
    if (!lines || lines.length === 0) continue; // nothing fired on this tab
    if (isHiddenByReady(order, readyAtByOrder[orderId])) continue;

    const doneCount = lines.filter((line) => line.done).length;
    const fired = cardFiredAtOf(lines);
    const ticketNumbers = [
      ...new Set(
        lines
          .map((line) => line.ticketNumber)
          .filter((n): n is number => typeof n === "number" && n > 0),
      ),
    ].sort((a, b) => a - b);

    cards.push({
      orderId,
      orderNo: order.orderId,
      tableLabel: lines[0].tableLabel,
      parcel: order.parcel === true,
      selfOrder: lines[0].selfOrder,
      ticketNumbers,
      lines,
      doneCount,
      totalCount: lines.length,
      allDone: doneCount === lines.length,
      cardFiredAt: fired.at,
      cardFiredAtApprox: fired.approx,
      // The newest line on the card — what the cook could see. ISO-8601 UTC
      // fixed width, so localeCompare IS the chronological compare (the same
      // justification cardFiredAtOf relies on).
      newestFiredAt: lines.reduce(
        (newest, line) => (line.firedAt.localeCompare(newest) > 0 ? line.firedAt : newest),
        lines[0].firedAt,
      ),
    });
  }

  // Oldest unfinished work first — the FIFO a cook expects ("this customer came
  // first"). orderId breaks ties so the render order is deterministic across
  // otherwise-identical fire instants.
  cards.sort((a, b) => {
    const byAge = a.cardFiredAt.localeCompare(b.cardFiredAt);
    if (byAge !== 0) return byAge;
    return a.orderId.localeCompare(b.orderId);
  });

  return cards.slice(0, KITCHEN_CARD_LIMIT);
}

/**
 * The confirmation a cook sees after tapping Ready.
 *
 * Owner decision 2026-09-26: Ready no longer requires every line to be ticked
 * (during a rush nobody has time, and a button that refuses strands the card).
 * So "cleared a finished card" and "cleared a card with lines still open" are
 * now BOTH reachable, and only the second might be a mis-tap worth undoing —
 * the toast has to tell them apart. Lives here, not in the page, because it is
 * pure string-building over card data and is unit-testable as such.
 */
export function readyToastMessage(card: KitchenOrderCard): string {
  const where = card.tableLabel || card.orderNo;
  const unticked = card.totalCount - card.doneCount;
  if (unticked <= 0) return `${where} marked ready`;
  return `${where} marked ready — ${unticked} line${unticked === 1 ? "" : "s"} not ticked`;
}

/** Re-exported so a consumer that only renders cards needs one import. */
export type { KitchenRow, KitchenOrderInput, Types };
