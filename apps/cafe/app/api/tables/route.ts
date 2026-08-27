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
import { createTableSchema, reorderTablesSchema } from "@/schemas";
import { TABLE_DUPLICATE_ERROR, unknownTableMessage } from "@/lib/table-admin";
import { reorderOps } from "@/lib/table-order";
import { mintUniquePublicToken } from "@/lib/public-token";

export const dynamic = "force-dynamic";

const CACHE_KEY = "tables";

// GET /api/tables — the floor plan (dynamic, CR1.1 — not a fixed "8 tables"),
// with live status (cached 30s).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    const cachedTables = cache.get(CACHE_KEY);
    if (cachedTables) return success(cachedTables);

    await connectDB();
    // The operator's hand arrangement wins; the name is the tie-break, so
    // tables that were never arranged (missing displayOrder) keep name order.
    const tables = await Table.find().sort({ displayOrder: 1, tableNo: 1 }).lean();
    cache.set(CACHE_KEY, tables, TTL.TABLES);
    return success(tables);
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
    // Status is not accepted from the client — a new table always starts
    // Available via the model default. displayOrder is likewise never accepted
    // from the client (same discipline) — a new table always lands at the END
    // of the arrangement, never the top, so it doesn't jump ahead of tables the
    // operator already arranged.
    const last = await Table.findOne({ displayOrder: { $exists: true } })
      .sort({ displayOrder: -1 })
      .select("displayOrder")
      .lean();
    // +1 past the last arranged table (count would collide after a delete).
    const displayOrder = (last?.displayOrder ?? -1) + 1;
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
    const known = await Table.find({ tableNo: { $in: parsed.data.tableNos } })
      .select("tableNo")
      .lean();
    // Every name must be a real table: a stale client list would otherwise
    // silently drop positions, and an unknown name must not create anything.
    if (known.length !== parsed.data.tableNos.length) {
      const found = new Set(known.map((t) => t.tableNo));
      const missing = parsed.data.tableNos.find((n) => !found.has(n));
      return failure(unknownTableMessage(missing ?? ""), 400);
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
