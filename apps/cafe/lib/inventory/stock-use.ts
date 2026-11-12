import mongoose from "mongoose";
import cache from "@/lib/cache";
import { PRODUCT_LIST, type LeanRow } from "@/lib/masters";
import { Product, type IProduct } from "@/models/Product";

// Inventory lite (plan: docs/superpowers/plans/2026-11-10-inventory-lite.md): what a sale takes out of stock,
// worked out from the menu items' stock use (Product.stockUse) at the moment the bill is settled or created as
// Pay Now. The result is the order's `stockUsed` snapshot — written in that same write, never in an extra one —
// and the cancel adds back exactly the snapshot, so a recipe edited later never changes it.
//
// Never blocks a sale (owner D3): stockUsedForSale catches everything and answers `undefined` (no deduct), so a
// read failure costs this one bill its stock move and nothing else. A Count fixes the number.

/** One size's own amount (milli-units per one sold), as stored on Product.stockUse[].sizes. */
export interface StockLinkSize {
  name: string;
  qty: number;
}

/** One Product.stockUse line: the stock item and the integer milli-units one sold unit takes. */
export interface StockLink {
  itemId: unknown;
  qty: number;
  sizes?: readonly StockLinkSize[];
}

/** The slice of a product row this reads (a cached list row, the create route's read, or the targeted read). */
export interface LinkedProduct {
  _id: unknown;
  stockUse?: readonly StockLink[];
}

/** The slice of an order line this reads. Every line counts — a free reward dish takes stock too. */
export interface SoldLine {
  productId: unknown;
  qty: number;
  variation?: string | null;
}

/** One summed stock line of a sale (Order.stockUsed). */
export interface StockUsedLine {
  itemId: string;
  qty: number;
}

/**
 * Pure: sums what the lines take per stock item. A line sold as a size uses that size's own amount when the link
 * has one, else the link's amount. A zero (or unusable) amount, or a malformed stock item id, is skipped. Sorted by
 * itemId; nothing → undefined.
 */
export function stockUsedOf(
  items: readonly SoldLine[],
  links: ReadonlyMap<string, readonly StockLink[]>,
): StockUsedLine[] | undefined {
  const sums = new Map<string, number>();
  for (const line of items) {
    const use = links.get(String(line.productId));
    if (!use) continue;
    for (const link of use) {
      const per = line.variation ? (link.sizes?.find((s) => s.name === line.variation)?.qty ?? link.qty) : link.qty;
      const take = per * line.qty;
      if (!Number.isSafeInteger(take) || take <= 0) continue;
      const key = String(link.itemId);
      // A malformed stored id would throw a CastError in the order write and block the sale (owner D3): skip it.
      if (!mongoose.isObjectIdOrHexString(key)) continue;
      sums.set(key, (sums.get(key) ?? 0) + take);
    }
  }
  if (sums.size === 0) return undefined;
  return [...sums]
    .map(([itemId, qty]) => ({ itemId, qty }))
    .sort((a, b) => (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));
}

/** The write fields for a snapshot: omit-empty, so a sale that used no stock stores no key at all. */
export function stockUsedFields(used: readonly StockUsedLine[] | undefined): { stockUsed?: StockUsedLine[] } {
  return used?.length ? { stockUsed: [...used] } : {};
}

export interface StockLinkDeps {
  /** The cached active product list GET /api/products fills, or undefined when this isolate's copy is cold. */
  cachedProducts(): readonly LinkedProduct[] | undefined;
  /** ONE read of the stock links of products the cache did not hold (archived on an open tab, a cold cache). */
  findLinks(ids: string[]): Promise<readonly LinkedProduct[]>;
}

export const STOCK_LINK_DEPS: StockLinkDeps = {
  // A peek only (never a fill): the same key and row shape listFromSpec(PRODUCT_LIST) caches. Full docs, no
  // select, so a product's stockUse is on the cached row.
  cachedProducts: () => cache.get<LeanRow<IProduct>[]>(PRODUCT_LIST.cacheKey),
  findLinks: (ids) => Product.find({ _id: { $in: ids }, stockUse: { $exists: true } }).select("stockUse").lean(),
};

/**
 * The snapshot for a sale: links from `known` (rows the caller already read), then the cached list, then one
 * targeted read for any product still unseen. Never rejects — any failure answers undefined (no deduct).
 */
export async function stockUsedForSale(
  items: readonly SoldLine[],
  known?: readonly LinkedProduct[],
  deps: StockLinkDeps = STOCK_LINK_DEPS,
): Promise<StockUsedLine[] | undefined> {
  try {
    const wanted = new Set(
      items.map((line) => String(line.productId)).filter((id) => mongoose.isValidObjectId(id)),
    );
    if (wanted.size === 0) return undefined;
    const seen = new Set<string>();
    const links = new Map<string, readonly StockLink[]>();
    const take = (rows: readonly LinkedProduct[] | undefined): void => {
      for (const row of rows ?? []) {
        const id = String(row._id);
        if (!wanted.has(id) || seen.has(id)) continue;
        seen.add(id);
        if (row.stockUse?.length) links.set(id, row.stockUse);
      }
    };
    const unseen = (): string[] => [...wanted].filter((id) => !seen.has(id));
    take(known);
    if (unseen().length > 0) take(deps.cachedProducts());
    const missing = unseen();
    if (missing.length > 0) take(await deps.findLinks(missing));
    return stockUsedOf(items, links);
  } catch {
    // Swallowed on purpose (owner D3): the sale goes through, this bill moves no stock. No console.* here.
    return undefined;
  }
}
