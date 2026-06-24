import { connectDB } from "@/lib/db";
import { Table } from "@/models/Table";
import cache, { TTL } from "@/lib/cache";
import { success, requireAuth, serverError } from "@/lib/api-helpers";

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
