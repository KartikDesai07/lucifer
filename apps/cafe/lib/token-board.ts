// Print customization S8 — token state, the kitchen gate and the token board. Pure: no DB, no React, no fetch
// (lib/token-board-server.ts runs the queries). Server-side only — screens import lib/token-view.ts instead.
//
// A token's status is DERIVED, never stored (01-PLAN §3.3): from the order's fire times and its KotTick stamps.
//   preparing — the kitchen's Ready does not cover the newest round (THE lost-ticket rule, isHiddenByReady);
//               a PAID order still preparing 2 hours after its last round is hidden too (owner s82: stale-out);
//   ready     — covered, not collected since the Ready mark, and marked less than the clear time ago;
//   hidden    — collected, or ready for longer than the clear time (auto-clear at read time: no write, no cron).
import { isHiddenByReady, newestFiredAtMs, KITCHEN_CARD_LIMIT, type FiredOrder } from "@/lib/kitchen-cards";
import type { KitchenOrderInput } from "@/lib/kitchen-board";
import { printConfigOf } from "@/lib/print";
import type { TokenBoardEntry } from "@/lib/token-view";
import { slipDayStart, tokenReadyClearMinutesOf } from "@pos/shared/slip-day";
import { MS_PER_MINUTE } from "@pos/shared/print-qr";
import { PRINT_BUDGET_BUSY_DAY } from "@pos/shared/print-budget";

// ── Filters ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An open tab — the kitchen board's only filter before S8, and still its whole filter while tokens are off. */
export const OPEN_TAB_FILTER = { status: "Pending", payment: "Unpaid" } as const;

/** GET /api/kitchen's open-tab select (s82: `parcel` added — the PARCEL header never rendered without it). */
export const KITCHEN_ORDER_SELECT = "orderId items kotRounds kotNumbers kotFiredAt tableNo parcel notes source createdAt";

/** The token board reads numbers, fire times and the order status (for the paid stale-out) only — never a name, an
 *  amount or a dish (S9's TV is public). The status never reaches the payload. */
export const TOKEN_BOARD_SELECT = "tokenNumber kotFiredAt createdAt status";

/** Bounds a day's token-order scan: twice a busy day's orders (print-budget.ts). */
export const TOKEN_DAY_SCAN_LIMIT = 2 * PRINT_BUDGET_BUSY_DAY.orders;
/** Paid token orders the kitchen arm returns at most — the board never shows more cards than this anyway. */
export const TOKEN_KITCHEN_LIMIT = KITCHEN_CARD_LIMIT;
/** Entries per list (preparing, ready) on the token board. */
export const TOKEN_BOARD_LIMIT = 50;

/** Owner s82 (review I-1): a PAID token order whose last round fired this long ago leaves the Kitchen board and the
 *  token list by itself, Ready or not — a kitchen that never taps Ready must not fill the board (its 60-card cap keeps
 *  the OLDEST cards, so a pile of stale paid cards would push new work off the screen). Open tabs are untouched: they
 *  leave the kitchen when settled or marked Ready, exactly as before S8. */
export const TOKEN_STALE_MINUTES = 120;

/** The order status a paid token order carries (Pay Now, or a settled tab). */
const PAID_STATUS = "Completed";

export type KitchenFilterMode = { tokenMode: false } | { tokenMode: true; dayStart: Date };
export const TOKENS_OFF: KitchenFilterMode = { tokenMode: false };

/** A paid token order of the current business day — what the kitchen's token arm adds (01-PLAN §3.4/§3.5). Paid
 *  orders cannot gain rounds, voids or moves (the items/void/move CASes require Pending), so the only later writes
 *  are cancel (excluded here by status) and notes. */
export function paidTokenFilter(dayStart: Date) {
  return { tokenNumber: { $exists: true }, status: PAID_STATUS, createdAt: { $gte: dayStart } };
}

/** THE kitchen gate, shared by kitchen GET, kitchen POST and the token route. Tokens off = a fresh copy of exactly
 *  today's open-tab filter (pinned key for key). */
export function kitchenOrderFilter(mode: KitchenFilterMode) {
  if (!mode.tokenMode) return { ...OPEN_TAB_FILTER };
  return { $or: [{ ...OPEN_TAB_FILTER }, paidTokenFilter(mode.dayStart)] };
}

/** Today's token orders, open or paid — the token board's and the token route's gate. */
export function tokenOrderFilter(dayStart: Date) {
  return {
    ...kitchenOrderFilter({ tokenMode: true, dayStart }),
    tokenNumber: { $exists: true },
    createdAt: { $gte: dayStart },
  };
}

/** Tokens off: exactly today's select. On: the token number too, for the card's chip. */
export function kitchenSelectOf(mode: KitchenFilterMode): string {
  return mode.tokenMode ? `${KITCHEN_ORDER_SELECT} tokenNumber` : KITCHEN_ORDER_SELECT;
}

export interface TokenMode {
  enabled: boolean;
  dayStart: Date;
  clearMinutes: number;
}

/** The token settings a request needs, resolved once. The business day follows the number restart time (§3.8). */
export function tokenModeOf(settings: Parameters<typeof printConfigOf>[0], now: Date): TokenMode {
  const token = printConfigOf(settings).token;
  return {
    enabled: token.enabled,
    dayStart: slipDayStart(now, token.resetMinutes),
    clearMinutes: tokenReadyClearMinutesOf(settings?.tokenReadyClearMinutes),
  };
}

export function filterModeOf(mode: TokenMode): KitchenFilterMode {
  return mode.enabled ? { tokenMode: true, dayStart: mode.dayStart } : TOKENS_OFF;
}

// ── Writes (KotTick; idempotent single-doc updates, no CAS — 01-PLAN §3.4) ───────────────────────────────────────────

/**
 * P4-C — the instant a Ready stamp covers: the newest fire instant the cook (or the POS) could SEE, not the instant
 * the request landed. isHiddenByReady hides an order while readyAt >= its newest kotFiredAt, so a `now` stamp would
 * also bury a round fired between the screen's last refresh and the tap — food nobody cooked, with nothing on any
 * screen reporting it. Clamped to now: a fast client clock (or a hand-made body) must not park a stamp in the
 * future and suppress rounds that have not happened yet. Absent or unparseable = now (the pre-P4-C behaviour).
 */
export function readyStampMs(seenFiredAt: string | undefined, nowMs: number): number {
  const seen = seenFiredAt ? new Date(seenFiredAt) : null;
  return seen && Number.isFinite(seen.getTime()) ? Math.min(seen.getTime(), nowMs) : nowMs;
}

/** Ready: the covering stamp plus the server instant of the mark (S8 — the clear timer runs from the mark, since
 *  readyAt may be minutes old already). Un-ready: both go. `$unset`, never null — readiness is field PRESENCE. */
export function readyUpdateOf(ready: boolean, seenFiredAt: string | undefined, nowMs: number) {
  return ready
    ? { $set: { readyAt: new Date(readyStampMs(seenFiredAt, nowMs)), readyMarkedAt: new Date(nowMs) } }
    : { $unset: { readyAt: "", readyMarkedAt: "" } };
}

/** Collected: when staff handed the order over. Undo: `$unset`, never null. */
export function collectedUpdateOf(collected: boolean, nowMs: number) {
  return collected ? { $set: { collectedAt: new Date(nowMs) } } : { $unset: { collectedAt: "" } };
}

// ── Status ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TokenStatus = "preparing" | "ready" | "hidden";

export interface TokenTickInput {
  readyAt?: Date | string;
  readyMarkedAt?: Date | string;
  collectedAt?: Date | string;
}

function msOf(value: Date | string | undefined): number | null {
  if (value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** What status derivation reads off an order: its fire times, and its status for the paid stale-out. */
export type TokenStateOrder = FiredOrder & { status?: string };

interface TokenState {
  status: TokenStatus;
  /** The Ready mark the status was read from (ready only). */
  markedMs?: number;
}

/** A paid order the kitchen has not covered with Ready, whose last round fired TOKEN_STALE_MINUTES ago or more. */
export function isStalePaidToken(order: TokenStateOrder, nowMs: number): boolean {
  return order.status === PAID_STATUS && nowMs - newestFiredAtMs(order) >= TOKEN_STALE_MINUTES * MS_PER_MINUTE;
}

function tokenStateOf(order: TokenStateOrder, tick: TokenTickInput | undefined, nowMs: number, clearMinutes: number): TokenState {
  if (!isHiddenByReady(order, tick?.readyAt)) {
    return isStalePaidToken(order, nowMs) ? { status: "hidden" } : { status: "preparing" };
  }
  // isHiddenByReady was true, so readyAt parses. A tick from before S8 has no readyMarkedAt: its readyAt stands in.
  const markedMs = msOf(tick?.readyMarkedAt) ?? (msOf(tick?.readyAt) as number);
  const collectedMs = msOf(tick?.collectedAt);
  // The last tap wins; Collected wins a same-millisecond tie. An unparseable collectedAt never hides work.
  if (collectedMs !== null && collectedMs >= markedMs) return { status: "hidden" };
  if (nowMs - markedMs >= clearMinutes * MS_PER_MINUTE) return { status: "hidden" };
  return { status: "ready", markedMs };
}

export function tokenStatusOf(
  order: TokenStateOrder,
  tick: TokenTickInput | undefined,
  nowMs: number,
  clearMinutes: number,
): TokenStatus {
  return tokenStateOf(order, tick, nowMs, clearMinutes).status;
}

// ── The board ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface TokenOrderInput extends FiredOrder {
  _id: unknown;
  tokenNumber?: number;
  status?: string;
}

export interface BuildTokenBoardInput {
  orders: TokenOrderInput[];
  ticks: Record<string, TokenTickInput | undefined>;
  nowMs: number;
  clearMinutes: number;
}

/** Preparing oldest-fired first; ready newest-marked first; each list capped. Entries carry exactly the
 *  TokenBoardEntry keys — numbers and times, nothing else. */
export function buildTokenBoard({ orders, ticks, nowMs, clearMinutes }: BuildTokenBoardInput): {
  preparing: TokenBoardEntry[];
  ready: TokenBoardEntry[];
} {
  const preparing: TokenBoardEntry[] = [];
  const ready: TokenBoardEntry[] = [];
  for (const order of orders) {
    if (typeof order.tokenNumber !== "number") continue;
    const id = String(order._id);
    const state = tokenStateOf(order, ticks[id], nowMs, clearMinutes);
    if (state.status === "hidden") continue;
    const entry: TokenBoardEntry = {
      id,
      number: order.tokenNumber,
      firedAt: new Date(newestFiredAtMs(order)).toISOString(),
    };
    if (state.status === "ready" && state.markedMs !== undefined) {
      ready.push({ ...entry, readySince: new Date(state.markedMs).toISOString() });
    } else preparing.push(entry);
  }
  // ISO-8601 UTC, fixed width — a lexicographic compare IS the chronological compare.
  preparing.sort((a, b) => a.firedAt.localeCompare(b.firedAt) || a.id.localeCompare(b.id));
  ready.sort((a, b) => (b.readySince ?? "").localeCompare(a.readySince ?? "") || a.id.localeCompare(b.id));
  return { preparing: preparing.slice(0, TOKEN_BOARD_LIMIT), ready: ready.slice(0, TOKEN_BOARD_LIMIT) };
}

/** The kitchen arm's survivors: paid token orders the kitchen's Ready does not yet cover and that are not stale,
 *  oldest first, capped. The comparison (not readyAt presence) keeps a held tab's later round on the board after it
 *  is settled. Every candidate is paid (paidTokenFilter), so the stale-out applies to all of them. */
export function pendingTokenIds(
  candidates: Array<FiredOrder & { _id: unknown }>,
  readyAtById: Record<string, Date | string | undefined>,
  nowMs: number,
): string[] {
  return candidates
    .filter((order) => !isHiddenByReady(order, readyAtById[String(order._id)]))
    .filter((order) => !isStalePaidToken({ ...order, status: PAID_STATUS }, nowMs))
    .sort((a, b) => newestFiredAtMs(a) - newestFiredAtMs(b))
    .slice(0, TOKEN_KITCHEN_LIMIT)
    .map((order) => String(order._id));
}

/** The two kitchen reads run at different instants: a settle between them can put one order in both. The open-tab
 *  arm wins, so no card (and no React key) is ever doubled. */
export function mergeKitchenArms<T extends Pick<KitchenOrderInput, "_id">>(open: T[], token: T[]): T[] {
  const seen = new Set(open.map((order) => String(order._id)));
  return [...open, ...token.filter((order) => !seen.has(String(order._id)))];
}
