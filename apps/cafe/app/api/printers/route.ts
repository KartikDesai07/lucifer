import { connectDB } from "@/lib/db";
import { createPrinter, listPrinters } from "@/lib/print-printers";
import { listStations } from "@/lib/print-stations";
import { printerBodySchema } from "@/lib/print-printer-schemas";
import { created, failure, requireAdmin, requireAuth, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Printing redesign, Phase 2 (spec §6.3, §11).
// GET /api/printers — every printer in display order, disabled ones too. Any signed-in device reads it (the
//   setup screens; from Session 2C, each device's agent finds the printers it writes to). Printing Phase 5:
//   `?stations=1` answers `{ printers, stations }` (a device routes its offline KOT as the server would); without it,
//   today's array (older pages read an array).
// POST /api/printers — add a printer, saved whole (admin).
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    if (new URL(req.url).searchParams.get("stations") === "1") {
      const [printers, stations] = await Promise.all([listPrinters(), listStations()]);
      return noStore(success({ printers, stations }));
    }
    return noStore(success(await listPrinters()));
  } catch (error) {
    return noStore(serverError("Failed to load the printers", error));
  }
}

export async function POST(req: Request) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, printerBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await createPrinter(parsed.data);
    return noStore(result.ok ? created(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to add the printer", error));
  }
}
