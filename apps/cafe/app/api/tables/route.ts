import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import cache, { TTL } from "@/lib/cache";
import {
  success,
  created,
  failure,
  validateBody,
  requireAuth,
  requireAdmin,
  isDuplicateKeyError,
  serverError,
} from "@/lib/api-helpers";
import { listTables, TABLE_LIST } from "@/lib/masters";
import { createTableSchema, reorderTablesSchema } from "@/schemas";
import { TABLE_DUPLICATE_ERROR, nextTableDisplayOrder } from "@/lib/table-admin";
import { checkAreaExists } from "@/lib/area-admin";
import {
  TABLE_LIST_CHANGED_ERROR,
  TABLES_FRESH_PARAM,
  reorderOps,
  sameTableSet,
} from "@/lib/table-order";
import { mintUniquePublicToken } from "@/lib/public-token";

export const dynamic = "force-dynamic";

// POST/PATCH's invalidation and PATCH's re-prime must use exactly the key the
// shared list function caches under, so it is read off the spec here.
const CACHE_KEY = TABLE_LIST.cacheKey;

// GET /api/tables — the floor plan (dynamic, CR1.1 — not a fixed "8 tables"),
// with live status (cached, TTL.TABLES). The query/sort/cache-key/TTL live in
// TABLE_LIST (lib/masters.ts), which GET /api/bootstrap serves the tables part
// from too, so this route and the bootstrap can never drift apart.
// ?fresh=1 (Setup's recovery read after a 409 or a failed save) drops THIS
// instance's cached list first, so the read below hits the DB and re-primes it.
// It sits after the auth check so an anonymous caller can never flush the cache.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  if (new URL(req.url).searchParams.get(TABLES_FRESH_PARAM) === "1") cache.del(CACHE_KEY);

  try {
    return success(await listTables());
  } catch (error) {
    return serverError("Failed to fetch tables", error);
  }
}

// POST /api/tables — add a table to the floor plan (admin config seam;
// PUT /api/tables/[tableNo] stays the staff-accessible live-status seam).
export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createTableSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    // A posted area must name a live one - nothing is created otherwise.
    if (parsed.data.areaId !== undefined) {
      const invalid = await checkAreaExists(parsed.data.areaId);
      if (invalid) return failure(invalid, 400);
    }
    // Status is not accepted from the client — a new table always starts
    // Available via the model default. displayOrder is likewise never accepted
    // from the client (same discipline) — a new table always lands at the END
    // of the arrangement, never the top, so it doesn't jump ahead of tables the
    // operator already arranged.
    const displayOrder = await nextTableDisplayOrder();
    // Every NEW table gets a QR sticker token up front, same discipline as
    // status/displayOrder above: publicToken is never accepted from the
    // client, only minted here.
    const publicToken = await mintUniquePublicToken((t) =>
      Table.exists({ publicToken: t }).then(Boolean),
    );
    const table = await Table.create({ ...parsed.data, displayOrder, publicToken });
    cache.del(CACHE_KEY);
    return created(table);
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(TABLE_DUPLICATE_ERROR, 400);
    return serverError("Failed to create table", error);
  }
}

// PATCH /api/tables — save the floor plan's manual arrangement (admin; the
// same config seam as POST/PATCH/DELETE on a table). Deliberately mounted on
// the COLLECTION route rather than a dedicated `/api/tables/order` path: a
// table may legitimately be NAMED "order" (TABLE_NO_PATTERN allows it), so a
// literal `/order` segment would be shadowed by — and would shadow — that table.
export async function PATCH(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, reorderTablesSchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const current = await Table.find().select("tableNo").lean();
    // The submitted list must be EXACTLY the current floor plan (the Categories
    // rule): a stale list (a table added, renamed or removed on another screen)
    // is refused whole, so nothing is half-arranged and an unknown name creates
    // nothing. Accepted residual: two admins saving in the very same instant can
    // both pass this check; the deterministic sort keeps the list valid and the
    // next save renumbers it.
    if (!sameTableSet(parsed.data.tableNos, current.map((t) => t.tableNo))) {
      return failure(TABLE_LIST_CHANGED_ERROR, 409);
    }
    await Table.bulkWrite(reorderOps(parsed.data.tableNos));
    cache.del(CACHE_KEY);
    // Return (and re-prime the cache with) the full ordered list so the client
    // can trust this one response instead of racing its own refetch.
    const tables = await Table.find().sort({ displayOrder: 1, tableNo: 1 }).lean();
    cache.set(CACHE_KEY, tables, TTL.TABLES);
    return success(tables);
  } catch (error) {
    return serverError("Failed to save the arrangement", error);
  }
}
