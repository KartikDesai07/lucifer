import { connectDB } from "@/lib/db";
import { createStation, listStations } from "@/lib/print-stations";
import { createStationBodySchema } from "@/lib/print-printer-schemas";
import { created, failure, requireAdmin, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Printing redesign, Phase 2 (spec §6.1, §11).
// GET /api/stations — every kitchen station in display order; the first read seeds the default "Kitchen".
//   Any signed-in device reads it (the setup screens; the category and item forms).
// POST /api/stations — add a station (admin).
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    return noStore(success(await listStations()));
  } catch (error) {
    return noStore(serverError("Failed to load the stations", error));
  }
}

export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, createStationBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await createStation(parsed.data);
    return noStore(result.ok ? created(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to add the station", error));
  }
}
