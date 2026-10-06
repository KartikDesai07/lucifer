import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { PRINTER_NOT_FOUND } from "@/lib/print-printers";
import { createPrinterTestJob } from "@/lib/print-printer-test";
import { printIntentOf } from "@/lib/print-order-jobs";
import { failure, notFound, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// A Mongoose required string refuses "" (house rule: staff names fall back to "Staff").
const UNNAMED_STAFF = "Staff";

// Printing redesign, Phase 2 Session 2D (spec §11). Admin only.
// POST /api/printers/[id]/test — one test slip on this printer's line, for its printing device (keyless: every tap
//   is one slip). The asking tab that writes this printer and can print on it now gets it leased at once (its
//   answer carries the job, decision 15); any other writer hears of it as of any slip. A printer routing may not
//   send slips to (switched off, no printing device, no slip chosen) is refused (409).
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(notFound(PRINTER_NOT_FOUND));

  try {
    await connectDB();
    const intent = printIntentOf(req);
    const result = await createPrinterTestJob({
      printerId: id,
      queuedBy: authed.session.user.name ?? UNNAMED_STAFF,
      originDeviceId: intent?.deviceId,
      leaseTabId: intent?.leaseTabId,
      readyPrinterIds: intent?.readyPrinterIds,
      nowMs: Date.now(),
    });
    return noStore(result.ok ? success(result.data) : failure(result.error, result.status));
  } catch (error) {
    return noStore(serverError("Failed to print the test slip", error));
  }
}
