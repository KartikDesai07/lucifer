// U1 Task 6 (2026-10-21): the /pos header's switch-order button and the Open orders panel it opens, in the owner's HTML
// (values 1.2-1.4 and 7 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.2; owner Q16, Q17). What the
// button says about the order on screen, and the panel's rows: our open tabs (the list the page already reads, no
// request of its own), searched on the device, in the tabs All · Tables · Walk-In. Pure: no React, no fetching.
import { inr } from "@pos/shared/utils";
import { cartTitle, WALK_IN } from "@/lib/pos-cart-view";
import type { Order } from "@/types";

/** The tile's dot (values 1.3 sw.dot): grey with no items, orange while an item is not sent, green when all are. */
export type SwitchDot = "empty" | "unsent" | "sent";

/** The switch button's words (values 1.3): the code tile, the title, the sub line, the "{N} open" pill (null until the
 *  open tabs' first answer: no pill, never "0 open") and the dot. */
export interface SwitchView {
  code: string;
  title: string;
  sub: string;
  count: string | null;
  dot: SwitchDot;
}

/** The order on screen, as the POS hook has it: the resumed tab (none for a new order), its customer's name, the
 *  quantities on screen (all of them, and those not sent yet) and the bill's total. */
export interface SwitchInput {
  resumedOrder: Pick<Order, "tableNo"> | null;
  customerName: string | undefined;
  count: number;
  newCount: number;
  total: number;
}

/** "1 item", "5 items" (the HTML says "1 items"; global constraints: singular for one). */
function itemsLabel(qty: number): string {
  return `${qty} ${qty === 1 ? "item" : "items"}`;
}

/** The code tile (design 6.2): a new order "+"; a walk-in tab "WI"; a table "T" + the digits of its name ("T-4" → "T4"),
 *  else the name's first two letters upper-case ("Rooftop" → "RO"). */
export function codeOf(tableNo: string | undefined, walkIn: boolean, isNew: boolean): string {
  if (isNew) return "+";
  if (walkIn || !tableNo) return "WI";
  const digits = tableNo.replace(/\D/g, "");
  if (digits) return `T${digits}`;
  const letters = tableNo.match(/\p{L}/gu)?.join("") ?? "";
  return (letters || tableNo.trim()).slice(0, 2).toUpperCase();
}

/** The switch button for the order on screen (values 1.3; design 6.2). The sub names the customer only when the order
 *  has one (ruling P17: never "Walk-In", which in our words means "no table"; a walk-in tab's title says so already).
 *  The pill counts our open tabs (a new order is not one yet); `openTabs` is undefined until the query's first answer,
 *  and there is no pill then. */
export function switchView(view: SwitchInput, openTabs: readonly Order[] | undefined): SwitchView {
  const tableNo = view.resumedOrder?.tableNo;
  const who = view.customerName?.trim();
  const items = view.count > 0 ? `${itemsLabel(view.count)} · ${inr(view.total)}` : "No items yet";
  return {
    code: codeOf(tableNo, !tableNo, !view.resumedOrder),
    title: cartTitle({ resumedOrder: view.resumedOrder }),
    sub: who ? `${who} · ${items}` : items,
    count: openTabs ? `${openTabs.length} open` : null,
    dot: view.count === 0 ? "empty" : view.newCount > 0 ? "unsent" : "sent",
  };
}

/** The panel's tabs (owner Q16): every open tab, those at a table, those with none. */
export const OPEN_ORDER_TABS = ["All", "Tables", "Walk-In"] as const;
export type OpenOrdersTab = (typeof OPEN_ORDER_TABS)[number];

/** A row of the panel (values 7.1, 7.2). */
export interface OpenOrderRow {
  /** The tab itself: tapping the row resumes it. */
  tab: Order;
  key: string;
  code: string;
  /** "Table T-4" / "Walk-In", and " · current" for the tab on screen. */
  id: string;
  /** "{customer} · {n} items · {m} min". */
  sub: string;
  /** "₹954", or "—" with nothing on the tab. */
  total: string;
  /** "In kitchen" for every open tab: we have no billed state (design 6.2). */
  status: string;
  /** The tab on screen: lit. */
  current: boolean;
  /** The row's rise delay, 25 ms apart, at most .3 s (values 7.2 `d`). */
  delay: string;
}

/** The customer a tab names: none for the server's "Walk-In" placeholder (a tab with no customer). */
function customerOf(tab: Order): string | null {
  const name = tab.customerName?.trim();
  return name && name !== WALK_IN ? name : null;
}

/** "{N} open · ₹{sum}" (values 7.2 summary), over every open tab, whatever the search or the tab. */
export function openOrdersSummary(tabs: readonly Order[]): string {
  return `${tabs.length} open · ${inr(tabs.reduce((sum, t) => sum + t.total, 0))}`;
}

/** The tabs' counts, whatever the search (values 7.2). */
export function openOrderCounts(tabs: readonly Order[]): Record<OpenOrdersTab, number> {
  const atTables = tabs.filter((t) => !!t.tableNo).length;
  return { All: tabs.length, Tables: atTables, "Walk-In": tabs.length - atTables };
}

function inTab(t: Order, tab: OpenOrdersTab): boolean {
  if (tab === "Tables") return !!t.tableNo;
  if (tab === "Walk-In") return !t.tableNo;
  return true;
}

/**
 * The panel's rows (values 7.2; design 6.2): the open tabs in the chosen tab, those whose title, table, customer or
 * order id holds the search (trimmed, any case; a phone number is not on the tab data, so it is not searched — owner
 * 2026-10-22: the placeholder names table, customer and order # only), the tab on screen first, then the newest.
 * Minutes as the cart's meta: since the tab opened, rounded, at least 1.
 */
export function openOrderRows(
  tabs: readonly Order[],
  current: string | undefined,
  q: string,
  tab: OpenOrdersTab,
  now: Date,
): OpenOrderRow[] {
  const query = q.trim().toLowerCase();
  const opened = (t: Order) => Date.parse(t.createdAt) || 0;
  const matches = tabs.filter((t) => {
    if (!inTab(t, tab)) return false;
    if (!query) return true;
    const words = [cartTitle({ resumedOrder: t }), t.tableNo ?? "", customerOf(t) ?? "", t.orderId].join(" ");
    return words.toLowerCase().includes(query);
  });
  const sorted = [...matches].sort((a, b) => Number(b._id === current) - Number(a._id === current) || opened(b) - opened(a));
  return sorted.map((t, k) => {
    const isCurrent = t._id === current;
    const qty = t.items.reduce((sum, i) => sum + i.qty, 0);
    const openedAt = Date.parse(t.createdAt);
    const mins = Number.isNaN(openedAt) ? null : Math.max(1, Math.round((now.getTime() - openedAt) / 60_000));
    const sub = [customerOf(t), qty > 0 ? itemsLabel(qty) : "No items", mins === null ? null : `${mins} min`];
    return {
      tab: t,
      key: t._id,
      code: codeOf(t.tableNo, !t.tableNo, false),
      id: cartTitle({ resumedOrder: t }) + (isCurrent ? " · current" : ""),
      sub: sub.filter((part): part is string => !!part).join(" · "),
      total: qty > 0 ? inr(t.total) : "—",
      status: "In kitchen",
      current: isCurrent,
      delay: `${Math.min(k * 0.025, 0.3).toFixed(3)}s`,
    };
  });
}
