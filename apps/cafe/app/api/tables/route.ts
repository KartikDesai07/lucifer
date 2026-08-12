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
import { createTableSchema } from "@/schemas";
import { TABLE_DUPLICATE_ERROR } from "@/lib/table-admin";

export const dynamic = "force-dynamic";

const CACHE_KEY = "tables";

// GET /api/tables — all 8 tables with live status (cached 30s)
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    const cachedTables = cache.get(CACHE_KEY);
    if (cachedTables) return success(cachedTables);

    await connectDB();
    const tables = await Table.find().sort({ tableNo: 1 }).lean();
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
    // Available via the model default.
    const table = await Table.create(parsed.data);
    cache.del(CACHE_KEY);
    return created(table);
  } catch (error) {
    if (isDuplicateKeyError(error)) return failure(TABLE_DUPLICATE_ERROR, 400);
    return serverError("Failed to create table", error);
  }
}
