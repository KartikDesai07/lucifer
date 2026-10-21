// U1 Task 4 (2026-10-21): what the /pos cart's head and lines say, in the owner's HTML (values 5.2, 5.4 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.5, 6.6; owner Q9, Q10): the title, a tab's
// "#012 · 32 min", the Table cell, a line's number and meta, the stored-order address the cart's Void action hands the
// void dialog, and when a selected line stays selected; U1 Task 7: the order bar's first line below 1024px (values
// 6.1). Pure: no React, no fetching; client-safe.
import { inr, orderItemModifierLines, orderLineKey } from "@pos/shared/utils";
import { tableAreaIdOf } from "@/lib/table-areas";
import type { Area, Order, OrderItem, Table } from "@/types";

/** A new order's title (design 6.5) and the word for "no table" (today's table chip's). */
export const NEW_ORDER_TITLE = "New order";
export const WALK_IN = "Walk-In";

/** The fields a line's meta reads: an order item or a cart line. */
export type LineMetaItem = Pick<OrderItem, "price" | "variation" | "modifiers" | "removedModifiers" | "instructions">;

/**
 * The line's one meta line (values 5.4): the variation, the add-ons ("+ a, b") and the removals ("NO a, NO b") through
 * the shared formatter (removals first, as every surface prints them), then the instructions — joined with ", " as the
 * HTML's meta; nothing to say reads the HTML's "₹{price} each".
 */
export function lineMeta(item: LineMetaItem): string {
  const note = item.instructions?.trim();
  const parts = [item.variation, ...orderItemModifierLines(item), note].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join(", ") : `${inr(item.price)} each`;
}

/** The HTML's two-digit line number: "01", "02" … (i counts from 0). */
export function lineNumber(i: number): string {
  return String(i + 1).padStart(2, "0");
}

export interface CartTitleView {
  resumedOrder: Pick<Order, "tableNo"> | null | undefined;
}

/** The cart's title (design 6.5): "Table T-4" / "Walk-In" for a resumed tab, "New order" for a new one. */
export function cartTitle(view: CartTitleView): string {
  if (!view.resumedOrder) return NEW_ORDER_TITLE;
  return view.resumedOrder.tableNo ? `Table ${view.resumedOrder.tableNo}` : WALK_IN;
}

/** What the order bar below 1024px reads (values 6.1; design 6.9; owner Q18): the quantity on the order (sent and new),
 *  the cart's title (cartTitle), whether an adjustment survived Clear (lib/pos-cart-props.ts hasPendingAdjustment), and
 *  the title of an unanswered send's notice (none when every send was answered). */
export interface OrderBarView {
  count: number;
  title: string;
  adjustment: boolean;
  noticeTitle: string | null;
}

/**
 * The order bar's first line (values 6.1; design 6.9): the HTML's "{n} items · {order}" with our title and "1 item" for
 * one; an empty order still has its bar (owner Q18) and reads "No items · New order"; an item-less cart whose promo,
 * reward, discount or extra charge survived Clear says so (D9.8c); an unanswered send says its notice's own title
 * ("Couldn't confirm"), so it is seen with the sheet closed.
 */
export function orderBarSummary(view: OrderBarView): string {
  if (view.noticeTitle) return view.noticeTitle;
  if (view.count === 0) return view.adjustment ? "Adjustment still applied" : `No items · ${view.title}`;
  return `${view.count} ${view.count === 1 ? "item" : "items"} · ${view.title}`;
}

/**
 * A tab's meta (values 0.1, 5.2; design 6.5): "#{the order id's last part} · {m} min" — the day's number from
 * ORD-YYYYMMDD-NNN, the minutes since the tab opened, at least 1, rounded (the HTML's formula). Null without a time.
 */
export function tabMeta(order: Pick<Order, "orderId" | "createdAt">, now: Date): string | null {
  const opened = Date.parse(order.createdAt);
  const dayNumber = order.orderId.split("-").pop();
  if (!dayNumber || Number.isNaN(opened)) return null;
  const mins = Math.max(1, Math.round((now.getTime() - opened) / 60_000));
  return `#${dayNumber} · ${mins} min`;
}

/** The Table cell's value (values 5.2 cell 1, owner Q9): "T-4 · Garden", the table alone in no area, "Walk-In". */
export function tableCellValue(tableNo: string | undefined, areaName: string | undefined): string {
  if (!tableNo) return WALK_IN;
  return areaName ? `${tableNo} · ${areaName}` : tableNo;
}

/** The name of the area a table sits in, through the shared area reader (lib/table-areas.ts); none when unknown. */
export function tableAreaName(
  tableNo: string | undefined,
  tables: readonly Table[] | undefined,
  areas: readonly Area[] | undefined,
): string | undefined {
  if (!tableNo || !tables || !areas) return undefined;
  const table = tables.find((t) => t.tableNo === tableNo);
  const areaKey = table ? tableAreaIdOf(table) : undefined;
  return areaKey === undefined ? undefined : areas.find((a) => a._id === areaKey)?.name;
}

/** A sent line's address in the STORED order, as the void dialog takes it (VoidItemDialog's initialLine): its position
 *  in order.items and its whole identity (orderLineKey) — the same pair the void route checks. */
export interface VoidLine {
  index: number;
  lineKey: string;
}

// A sent line's cart id starts "#{its position in the stored order}:" (hooks/use-cart.ts cartItemFromOrderItem).
const SENT_LINE_ID = /^#(\d+):/;

/** The address of a sent cart line in the resumed tab; null for a new line, without a tab, or when the stored order no
 *  longer holds that dish there. */
export function voidLineOf(
  line: { lineId: string; productId: string; kotRound: number },
  order: Pick<Order, "items"> | null | undefined,
): VoidLine | null {
  if (!order || line.kotRound < 1) return null;
  const match = SENT_LINE_ID.exec(line.lineId);
  if (!match) return null;
  const index = Number(match[1]);
  const stored = order.items[index];
  if (!stored || (stored.kotRound ?? 0) < 1 || stored.productId !== line.productId) return null;
  return { index, lineKey: orderLineKey(stored) };
}

/** The position the void dialog opens on: the named line, while the stored order still holds it there (same position,
 *  same identity, sent); else none — the operator picks, and the server refuses a stale view anyway. */
export function matchVoidLine(items: readonly OrderItem[], line: VoidLine): number | null {
  const stored = items[line.index];
  if (!stored || (stored.kotRound ?? 0) < 1) return null;
  return orderLineKey(stored) === line.lineKey ? line.index : null;
}

/** The cart's one selected line (owner Q10), with the order it was selected in ("new", or the tab's id). */
export interface LineSelection {
  lineId: string;
  scope: string;
}

/** A selection holds while its line is on screen, in the same order, and the cart is neither busy nor frozen. */
export function selectionHolds(
  sel: LineSelection,
  now: { scope: string; busy: boolean; lineIds: readonly string[] },
): boolean {
  return !now.busy && sel.scope === now.scope && now.lineIds.includes(sel.lineId);
}
