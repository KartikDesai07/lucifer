// Skip-KOT: "no kitchen ticket" items (water bottles and other ready-to-serve things).
// PURE and client-safe — no Mongoose, no DB, no value imports. The server stamps `noKot: true` on a
// stored line when the line is written (lib/kitchen-lines-server.ts); everything else (the KOT, the
// kitchen screen, the token board, the void slip, the number draw) only READS that stamp through the
// helpers here. A kitchen line carries NO key at all (omit-empty), so absent = today, byte for byte.
//
// KOT kitchen order (2026-11-01): the same write-time pass stamps `kotRank` (its category's place in
// the admin's Kitchen order) on a kitchen line, omit-empty. Every kitchen ticket reads its lines
// through kitchenLinesOf below, which sorts each round by that rank — no rank anywhere = today.

// The fields every helper reads. `boolean` rather than `true`: the Mongoose model types it boolean
// (like `reward`) and the shared client type types it `true`; both are assignable here.
export interface KitchenFlagged {
  noKot?: boolean;
  kotRank?: number; // the category's Kitchen-order place; absent = not placed (prints after the placed)
}

// A line that carries a KOT round (0 / absent = not sent to the kitchen yet).
export interface KitchenRoundLine extends KitchenFlagged {
  kotRound?: number;
}

// The first KOT round number: a line stamped below it was never sent (a cart line, or a legacy row).
const FIRST_KOT_ROUND = 1;

// True when this line never goes on a kitchen ticket.
export function skipsKitchenTicket(line: KitchenFlagged): boolean {
  return line.noKot === true;
}

// Stamp (skip) or clear the flag, keeping the omit-empty discipline: a kitchen line never gets a key,
// and a line that already has no key comes back as the SAME object.
export function withNoKot<T extends KitchenFlagged>(line: T, skip: boolean): T {
  if (skip) return line.noKot === true ? line : { ...line, noKot: true };
  if (!("noKot" in line)) return line;
  const copy = { ...line };
  delete copy.noKot;
  return copy;
}

// True ONLY when this KOT round has at least one line and EVERY line in it skips the kitchen — such a
// round gets no ticket, no KOT number, and (with the whole order skipping) no token.
export function roundSkipsKitchen(items: readonly KitchenRoundLine[], round: number): boolean {
  let seen = false;
  for (const it of items) {
    if ((it.kotRound ?? 0) !== round) continue;
    if (!skipsKitchenTicket(it)) return false;
    seen = true;
  }
  return seen;
}

// True ONLY when the order has at least one fired line and every fired line skips the kitchen.
// An order with no fired line yet is NOT "all skip" (nothing has been decided for the kitchen).
export function orderSkipsKitchen(order: { items: readonly KitchenRoundLine[] }): boolean {
  let seen = false;
  for (const it of order.items) {
    if ((it.kotRound ?? 0) < FIRST_KOT_ROUND) continue;
    if (!skipsKitchenTicket(it)) return false;
    seen = true;
  }
  return seen;
}

// Stamp or clear the Kitchen-order rank, omit-empty like withNoKot: an unplaced line never gets a
// key, and a line whose rank is already right comes back as the SAME object.
export function withKotRank<T extends KitchenFlagged>(line: T, rank: number | undefined): T {
  if (rank !== undefined) return line.kotRank === rank ? line : { ...line, kotRank: rank };
  if (!("kotRank" in line)) return line;
  const copy = { ...line };
  delete copy.kotRank;
  return copy;
}

// The line's sort key: an unplaced line (no rank, or anything that is not a finite number) comes after
// every placed one. The Kitchen screen breaks its in-round ties with the same key.
export function kitchenRankOf(line: KitchenFlagged): number {
  return typeof line.kotRank === "number" && Number.isFinite(line.kotRank) ? line.kotRank : Number.MAX_SAFE_INTEGER;
}

// Kitchen order: each round's lines by rank, unplaced last, ties in the order added. Rounds keep the
// order they first appear in (a whole-tab reprint still reads round by round). STABLE, and returns
// the SAME array when no line carries a rank or nothing moves.
function inKitchenOrder<T extends KitchenRoundLine>(lines: readonly T[]): readonly T[] {
  if (!lines.some((l) => l.kotRank !== undefined)) return lines;
  const roundStart = new Map<number, number>();
  lines.forEach((l, i) => {
    if (!roundStart.has(l.kotRound ?? 0)) roundStart.set(l.kotRound ?? 0, i);
  });
  const sorted = lines
    .map((line, index) => ({ line, index, round: roundStart.get(line.kotRound ?? 0) ?? index }))
    .sort((a, b) => a.round - b.round || kitchenRankOf(a.line) - kitchenRankOf(b.line) || a.index - b.index)
    .map((entry) => entry.line);
  return sorted.every((line, i) => line === lines[i]) ? lines : sorted;
}

// The lines the kitchen should see, in Kitchen order. Returns the SAME array when nothing is dropped
// or moved, so an order without a skip line or a rank flows through unchanged (and unallocated).
export function kitchenLinesOf<T extends KitchenRoundLine>(lines: readonly T[]): readonly T[] {
  const filtered = lines.filter((l) => !skipsKitchenTicket(l));
  return inKitchenOrder(filtered.length === lines.length ? lines : filtered);
}

// The order as the kitchen should see it: skip lines dropped from `items`, the rest in Kitchen order.
// Returns the SAME object reference when nothing changes, so every payload/snapshot of an ordinary
// order is unchanged.
export function kitchenOrderOf<O extends { items: readonly KitchenRoundLine[] }>(order: O): O {
  const kept = kitchenLinesOf(order.items);
  return kept === order.items ? order : { ...order, items: kept };
}

// ── Write-time resolution (pure half of kitchen-lines-server.ts) ─────────────────────────────────

// What the resolution needs to know about one menu item.
export interface ProductKitchenFacts {
  categoryId?: string;
  noKot?: boolean;
}

// A line skips iff `(product.noKot ?? categoryHasNoKot) === true`: the item's own choice wins (true =
// never, false = always), and only an item with no choice follows its category. An unknown product
// (not found / not a valid id) is a kitchen line.
export function lineSkipsByMenu(
  productId: unknown,
  products: ReadonlyMap<string, ProductKitchenFacts>,
  skipCategoryIds: ReadonlySet<string>,
): boolean {
  const product = products.get(String(productId));
  if (!product) return false;
  const categorySkips = product.categoryId !== undefined && skipCategoryIds.has(product.categoryId);
  return (product.noKot ?? categorySkips) === true;
}

const NO_RANKS: ReadonlyMap<string, number> = new Map();

// Stamp every line from the menu facts and say whether the list still holds a kitchen line
// (`kitchen`). An empty list is `kitchen: true` (nothing says "skip"). Skip lines get `noKot: true`,
// kitchen lines carry no key. A kitchen line also gets its category's Kitchen-order rank
// (`categoryRanks`, empty = no kitchen order set); a skip line, or one with no ranked category, none.
export function stampKitchenFlags<T extends KitchenFlagged & { productId: unknown }>(
  lines: readonly T[],
  products: ReadonlyMap<string, ProductKitchenFacts>,
  skipCategoryIds: ReadonlySet<string>,
  categoryRanks: ReadonlyMap<string, number> = NO_RANKS,
): { lines: T[]; kitchen: boolean } {
  const stamped = lines.map((l) => {
    const skip = lineSkipsByMenu(l.productId, products, skipCategoryIds);
    const categoryId = products.get(String(l.productId))?.categoryId;
    const rank = skip || categoryId === undefined ? undefined : categoryRanks.get(categoryId);
    return withKotRank(withNoKot(l, skip), rank);
  });
  const kitchen = stamped.length === 0 || stamped.some((l) => !skipsKitchenTicket(l));
  return { lines: stamped, kitchen };
}

// ── Plain-English copy (one source for the menu forms, Printer setup, tags and toasts) ───────────

export const KITCHEN_CATEGORY_SWITCH_LABEL = "Send to the kitchen (KOT)";
export const KITCHEN_CATEGORY_OFF_HINT =
  "Off for ready-to-serve items, like water bottles. They still go on the bill, never on a KOT or the Kitchen screen.";

export const KITCHEN_ITEM_SELECT_LABEL = "Kitchen ticket (KOT)";
export const KITCHEN_ITEM_ALWAYS_LABEL = "Always send to the kitchen";
export const KITCHEN_ITEM_NEVER_LABEL = "No kitchen ticket: hand it over directly";

// "Same as its category (...)" — the bracket names what the category currently does.
export function kitchenItemSameLabel(categorySkips: boolean): string {
  return `Same as its category (${categorySkips ? "no kitchen ticket" : "sent to the kitchen"})`;
}

export const KITCHEN_PRINTER_SETUP_NOTE = "Items with no kitchen ticket never print on a KOT.";
export const KITCHEN_TOKEN_HINT = "An order with only no-KOT items gets no token.";

// The tag on a Categories / Items row.
export const KITCHEN_NO_KOT_TAG = "No KOT";

// Toasts: a send, a Notify Kitchen / reprint and a moved table where nothing is kitchen work.
export const KITCHEN_NOTHING_TO_SEND_MESSAGE =
  "Nothing to send to the kitchen. These items are handed over directly.";
