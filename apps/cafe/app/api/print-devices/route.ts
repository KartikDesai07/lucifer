import { connectDB } from "@/lib/db";
import { listPrintDevices } from "@/lib/print-device";
import { requireAdmin, serverError, success } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// Printing redesign, Phase 2 Session 2D (spec §6.4, §11 Devices). Admin only.
// GET /api/print-devices — every device that prints or leases, the most recently seen first, with the server's
//   online verdict: the Printer setup page's Devices section, and the choice of a network printer's printing
//   device. Read on that page only (never polled).
export async function GET() {
  const authed = await requireAdmin();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    return noStore(success(await listPrintDevices(Date.now())));
  } catch (error) {
    return noStore(serverError("Failed to load the devices", error));
  }
}
