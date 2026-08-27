import { type FilterQuery, type PipelineStage } from "mongoose";
import type { IProduct } from "@/models/Product";
import type { ProductVariation } from "@/types";

// Pure shaping + the query filter for the PUBLIC (unauthenticated) QR menu —
// the read side of phase CR2.1. No `connectDB`, no HTTP, no cache — those stay
// in the route (`app/api/public/menu/route.ts`), which is the only caller.
//
// THREAT MODEL: `toPublicMenuItem` below is the entire security boundary of
// this feature. The route's `.select()` is a performance courtesy, not a
// guarantee — the actual promise that a diner's browser (no login, no session,
// no rate limit, cacheable by any proxy on the path) never sees cost price,
// `isActive`, `publicVisible`, timestamps, or a raw Mongo `_id` shape is that
// this function builds a BRAND-NEW object literal naming only the fields a
// diner may see. It never spreads its input. Adding a key to that literal
// publishes it to the internet — treat every addition here as a public API
// decision, not an implementation detail.

export const PUBLIC_MENU_CACHE_KEY = "public-menu";

// `$ne: false` — not `publicVisible: true` — is what makes an ABSENT field mean
// visible. models/Product.ts stores `publicVisible` with no `default:`, so the
// overwhelming majority of products carry no such key at all; only an explicit
// `false` may hide one from a diner. `isActive: true` keeps archived
// (soft-deleted) stock out regardless of `publicVisible`.
export const PUBLIC_PRODUCT_FILTER: FilterQuery<IProduct> = {
  isActive: true,
  publicVisible: { $ne: false },
};

// The lean shape `toPublicMenuItem` reads. Deliberately narrower than
// `IProduct` (no `isActive`, `publicVisible`, `_id` typed as an ObjectId, or
// timestamps) so a future `.select()` that forgets a field fails to compile
// instead of silently under-fetching, and so this file cannot be tempted into
// accepting — and therefore leaking — the whole document.
export interface PublicProductSource {
  _id: unknown; // stringified via String(); never assumed to already be a string
  name: string;
  category: string;
  price: number;
  variations?: ProductVariation[];
  discount: number;
  available: boolean;
  image: string;
  modifiers: string[];
}

// Everything a diner's browser is allowed to know about one menu item. This
// interface IS the allow-list described in the THREAT MODEL comment above.
export interface PublicMenuItem {
  id: string;
  name: string;
  category: string;
  price: number;
  variations?: ProductVariation[];
  discount: number;
  // false = sold out. RETURNED, never omitted: hiding a sold-out item mid-menu
  // read is the documented worst UX failure in this category (a diner orders
  // something that quietly vanished) — the page shows it struck through instead.
  available: boolean;
  image: string;
  modifiers: string[];
}

// Builds a brand-new object naming only the allowed keys — never a spread of
// the input — so an extra field on the source (a stray `cost`, `isActive`,
// `publicVisible`, `_id` bookkeeping, timestamps) cannot ride along even if a
// future `.select()` widens by mistake.
export function toPublicMenuItem(product: PublicProductSource): PublicMenuItem {
  const item: PublicMenuItem = {
    id: String(product._id),
    name: product.name,
    category: product.category,
    price: product.price,
    discount: product.discount,
    available: product.available,
    image: product.image,
    modifiers: product.modifiers,
  };
  // Omit-empty, matching the stored shape (models/Product.ts): an item sold
  // one way only carries no `variations` key on the wire either.
  if (product.variations && product.variations.length > 0) {
    item.variations = product.variations;
  }
  return item;
}

export const PUBLIC_TABLES_CACHE_KEY = "public-tables";

// The one field of a Table a diner may see (ADDENDUM 1 / D4): the NAME, which
// is already printed on the furniture and visible to anyone in the room. The
// projection exists for the same reason as toPublicMenuItem's — a Table doc
// also carries `publicToken` (the QR secret), `status`, `currentOrderId` and
// charge config, and none of those may ever ride along to /api/public/tables.
// A charge IS shown to a diner, but only via /api/public/table/[token] once a
// real table is resolved — the open list would price-tag the whole room.
export interface PublicTableSource {
  tableNo: string;
}

export interface PublicTable {
  tableNo: string;
}

export function toPublicTable(table: PublicTableSource): PublicTable {
  return { tableNo: table.tableNo };
}

export interface PublicCategorySource {
  name: string;
  order: number;
}

export interface PublicCategory {
  name: string;
  order: number;
}

// No threat-model note needed here: a category name and its display order
// carry nothing an operator would consider sensitive, and this shape happens
// to already equal the source's — but it stays an explicit projection (not a
// pass-through) so a field added to Category later needs a decision here too.
export function toPublicCategory(category: PublicCategorySource): PublicCategory {
  return { name: category.name, order: category.order };
}

// S4 — cart recommendations ("Goes well with your order"). Pure
// aggregation-pipeline builder only: no `connectDB`, no Order model bind, no
// cache — those stay in the route (the only caller), matching every other
// export in this file.
export const TOP_SELLER_DAYS = 30;
export const TOP_SELLER_LIMIT = 10;

// Popularity is a browsing signal, not a financial one (unlike
// models/daily-rollup.ledger.ts's revenue rollups) — a still-open Pending
// order counts the same as a Completed one. ORDER_STATUSES (@pos/shared/
// constants) carries exactly three values — "Pending" | "Completed" |
// "Cancelled" — there is no separate "Voided" order status; a line-level
// void (Order.voids, an append-only trail on an otherwise live order) never
// changes the parent order's status, so only a fully Cancelled order is
// excluded here — same `status: { $ne: "Cancelled" }` idiom already used by
// the customer dues reconcile aggregation.
export function topSellerPipeline(cutoff: Date): PipelineStage[] {
  return [
    { $match: { createdAt: { $gte: cutoff }, status: { $ne: "Cancelled" } } },
    { $unwind: "$items" },
    { $group: { _id: "$items.productId", qty: { $sum: "$items.qty" } } },
    { $sort: { qty: -1 } },
    { $limit: TOP_SELLER_LIMIT },
  ];
}
