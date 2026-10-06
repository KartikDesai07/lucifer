import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import cache from "@/lib/cache";
import { CATEGORY_LIST, PRODUCT_LIST } from "@/lib/masters";
import { STATION_NOT_FOUND, deleteStation, updateStation } from "@/lib/print-stations";
import { updateStationBodySchema } from "@/lib/print-printer-schemas";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Printing redesign, Phase 2 (spec §6.1, §11). Admin only.
// PUT /api/stations/[id] — rename, and/or make it the default station.
// DELETE /api/stations/[id] — delete a station that is not the default; every category, item and printer that
//   chose it goes back to the default (lib/print-stations.ts).
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(STATION_NOT_FOUND));

  const parsed = await validateBody(req, updateStationBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await updateStation(id, parsed.data);
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to save the station", error));
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(STATION_NOT_FOUND));

  try {
    await connectDB();
    const result = await deleteStation(id);
    if (!result.ok) return noStore(failure(result.error, result.status));
    // Categories and items that chose it lost their stationId: the cached lists must not show it.
    cache.del(CATEGORY_LIST.cacheKey);
    cache.del(PRODUCT_LIST.cacheKey);
    return noStore(success(result.data));
  } catch (error) {
    return noStore(serverError("Failed to delete the station", error));
  }
}
