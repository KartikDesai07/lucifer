import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import cache, { TTL } from "@/lib/cache";
import { serverError, success } from "@/lib/api-helpers";
import {
  PUBLIC_TABLES_CACHE_KEY,
  toPublicTable,
  type PublicTable,
} from "@/lib/public-menu";

export const dynamic = "force-dynamic";

const TABLES_UNAVAILABLE_MESSAGE = "The table list is temporarily unavailable";

// Same reasoning as /api/public/menu's header: table names changing 30s late
// is harmless (the pick is advisory anyway), and stale-while-revalidate keeps
// a burst of scans from all reaching Mongo.
const PUBLIC_TABLES_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=60";

function withPublicTablesHeaders<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", PUBLIC_TABLES_CACHE_CONTROL);
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

// GET /api/public/tables — table NAMES only, for the bare /m route's chooser
// (ADDENDUM 1 / owner decision D4: a diner who didn't scan picks a table by
// the number printed on it).
//
// PUBLIC on purpose, same discipline as GET /api/public/menu. What it exposes
// is exactly what standing in the room exposes: the names on the furniture,
// in the operator's arranged order. NEVER a `publicToken` (that would hand
// out every QR secret in one response), never `status`/`currentOrderId`
// (occupancy is staff business), never a charge (priced only via
// /api/public/table/[token] once a real table is resolved), never an `_id` —
// `toPublicTable` in lib/public-menu.ts is the boundary that enforces this.
// Table writes invalidate only the staff "tables" key, not this one; at
// TTL.TABLES (seconds) the stale window is shorter than the CDN one above.
// Never throws to the client — a DB hiccup degrades to a 503 envelope.
export async function GET() {
  try {
    const cached = cache.get<PublicTable[]>(PUBLIC_TABLES_CACHE_KEY);
    if (cached) return withPublicTablesHeaders(success(cached));

    await connectDB();

    // Sort mirrors GET /api/tables exactly: the operator's hand arrangement
    // wins, name is the tie-break for never-arranged tables.
    const tables = await Table.find()
      .sort({ displayOrder: 1, tableNo: 1 })
      .select("tableNo")
      .lean();

    const payload = tables.map(toPublicTable);
    cache.set(PUBLIC_TABLES_CACHE_KEY, payload, TTL.TABLES);
    return withPublicTablesHeaders(success(payload));
  } catch (error) {
    // no-store, never the success headers: an explicit max-age makes even a
    // 503 storable (RFC 9111) — same review fix as /api/public/menu.
    const res = serverError(TABLES_UNAVAILABLE_MESSAGE, error, 503);
    res.headers.set("Cache-Control", "no-store");
    res.headers.set("X-Content-Type-Options", "nosniff");
    return res;
  }
}
