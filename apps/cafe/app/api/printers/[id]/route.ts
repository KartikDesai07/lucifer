import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { PRINTER_NOT_FOUND, deletePrinter, replacePrinter } from "@/lib/print-printers";
import { printerBodySchema } from "@/lib/print-printer-schemas";
import { failure, notFound, requireAdmin, serverError, success, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Printing redesign, Phase 2 (spec §6.3, §11). Admin only.
// PUT /api/printers/[id] — save a printer whole (the setup form's one unit).
// DELETE /api/printers/[id] — remove a printer. Its queued slips fail visibly at the next sweep
//   (PRINTER_GONE_MESSAGE, under "Couldn't print"), never moved to another printer (Session 2C).
export async function PUT(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(PRINTER_NOT_FOUND));

  const parsed = await validateBody(req, printerBodySchema);
  if ("error" in parsed) return parsed.error;

  try {
    await connectDB();
    const result = await replacePrinter(id, parsed.data);
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to save the printer", error));
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(PRINTER_NOT_FOUND));

  try {
    await connectDB();
    const result = await deletePrinter(id);
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to delete the printer", error));
  }
}
