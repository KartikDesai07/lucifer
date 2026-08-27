import { connectDB } from "@/lib/db";
import { Category } from "@/models/Category";
import { Product } from "@/models/Product";
import { Order } from "@/models/Order";
import cache, { TTL } from "@/lib/cache";
import { readSettings } from "@/lib/settings";
import { serverError, success } from "@/lib/api-helpers";
import type { PublicGstConfig } from "@pos/shared/public";
import {
  PUBLIC_MENU_CACHE_KEY,
  PUBLIC_PRODUCT_FILTER,
  TOP_SELLER_DAYS,
  toPublicCategory,
  toPublicMenuItem,
  topSellerPipeline,
  type PublicCategory,
  type PublicMenuItem,
} from "@/lib/public-menu";

export const dynamic = "force-dynamic";

const MENU_UNAVAILABLE_MESSAGE = "The menu is temporarily unavailable";

// S4 — "Goes well with your order" cart recommendations. A dedicated
// module-level memo, NOT the `cache` singleton above: the top-seller
// aggregation ($unwind over TOP_SELLER_DAYS of Orders) is expensive enough to
// deserve its own longer-lived window independent of the outer payload
// cache's shorter TTL, and simple enough not to need node-cache's key/TTL
// machinery for a single always-fresh-enough value.
const TOP_SELLER_MEMO_MS = 10 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
let topSellerMemo: { at: number; ids: string[] } | null = null;

// Never lets a recommendation-engine hiccup fail (or slow down) the menu
// itself: any aggregation error degrades to an empty list here, inside its
// own try/catch, so a bad Orders query can only ever mean an empty
// "Goes well with your order" section — never a 503 for the whole
// diner-facing menu (the route's own outer try/catch below is the backstop
// for everything else, not for this).
async function popularProductIds(): Promise<string[]> {
  if (topSellerMemo && Date.now() - topSellerMemo.at < TOP_SELLER_MEMO_MS) {
    return topSellerMemo.ids;
  }
  try {
    const cutoff = new Date(Date.now() - TOP_SELLER_DAYS * ONE_DAY_MS);
    const rows = await Order.aggregate(topSellerPipeline(cutoff));
    const ids = rows.map((row) => String(row._id));
    topSellerMemo = { at: Date.now(), ids };
    return ids;
  } catch {
    return [];
  }
}

// A menu changing up to 30s late is harmless; a diner's phone hammering a
// 512MB M0 on every pull-to-refresh is not. `stale-while-revalidate` lets any
// intermediary (Vercel's edge, a browser) keep serving the last good copy
// while one request refills it, so a burst of scans never all reach the DB.
const PUBLIC_MENU_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

interface PublicMenuPayload {
  // The cafe's own name for the page header. Printed on every receipt this
  // cafe hands out, so publishing it here discloses nothing new — and it must
  // come through THIS route because GET /api/settings is auth-gated.
  restaurantName: string;
  // Whether the diner-facing page may let a diner pick or change the table
  // mid-order. selfOrderMode and showPastOrdersToDiner stay server-side
  // (CR2.2).
  allowTableChange: boolean;
  // GST config so the diner cart can display a tax-exclusive running total
  // that matches what the kitchen will actually bill (review FIX1). No new
  // disclosure: these three fields already print on every receipt this cafe
  // hands out — same reasoning as restaurantName above.
  gst: PublicGstConfig;
  categories: PublicCategory[];
  items: PublicMenuItem[];
  // S4 — top-seller productIds (last TOP_SELLER_DAYS days), read by the
  // cart's "Goes well with your order" section. IDs only, resolved against
  // this SAME payload's `items` client-side — never a second disclosure.
  popular: string[];
}

function withPublicMenuHeaders<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", PUBLIC_MENU_CACHE_CONTROL);
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

// GET /api/public/menu — the diner-facing menu. No session, no admin chrome.
//
// PUBLIC on purpose — this and GET /api/public/table/[token] are the only
// unauthenticated DATA routes besides GET /api/branding/[slot] and
// /api/health. What it exposes is exactly what a printed physical menu would:
// names, categories, prices and photos of items the operator chose to publish
// (see the THREAT MODEL comment in lib/public-menu.ts, which is what actually
// enforces that boundary). Not rate-limited, matching those siblings: there is
// nothing here worth brute-forcing, and the 30s cache plus the in-process
// burst buffer below mean real traffic mostly never reaches Mongo at all.
// Never throws to the client — a DB hiccup degrades to a 503 envelope, not a
// stack trace, because a diner's browser is the one caller this app can never
// show an error page to.
export async function GET() {
  try {
    const cached = cache.get<PublicMenuPayload>(PUBLIC_MENU_CACHE_KEY);
    if (cached) return withPublicMenuHeaders(success(cached));

    await connectDB();

    const [categories, products, settings, popular] = await Promise.all([
      Category.find().sort({ order: 1, name: 1 }).select("name order").lean(),
      // Field list mirrors PublicProductSource exactly — nothing wider is ever
      // pulled off Mongo for this route, even before toPublicMenuItem projects
      // it down again.
      Product.find(PUBLIC_PRODUCT_FILTER)
        .sort({ category: 1, name: 1 })
        .select("name category price variations discount available image modifiers")
        .lean(),
      // readSettings, NEVER getSettings: the getter's $setOnInsert upsert
      // writes updatedAt on every call (probed), and this route is public —
      // anonymous scans must not be able to drive writes at a 512MB M0.
      readSettings(),
      popularProductIds(),
    ]);

    const payload: PublicMenuPayload = {
      // "" (→ the page's generic fallback) on a cafe with no Settings doc yet;
      // a render path degrades, never creates the singleton.
      restaurantName: settings?.restaurantName ?? "",
      allowTableChange: settings?.allowTableChange ?? true,
      gst: {
        enabled: settings?.gstEnabled ?? false,
        rate: settings?.gstRate ?? 0,
        mode: settings?.gstMode ?? "inclusive",
      },
      categories: categories.map(toPublicCategory),
      items: products.map(toPublicMenuItem),
      popular,
    };
    cache.set(PUBLIC_MENU_CACHE_KEY, payload, TTL.PRODUCTS);
    return withPublicMenuHeaders(success(payload));
  } catch (error) {
    // no-store, never the success headers: an explicit max-age makes even a
    // 503 storable (RFC 9111), so a one-second Mongo hiccup would keep being
    // served to diners from a cache for 30s+ after recovery (review fix).
    const res = serverError(MENU_UNAVAILABLE_MESSAGE, error, 503);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  }
}
