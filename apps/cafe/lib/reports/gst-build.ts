// buildGstReport — the ONE place the GST report's numbers are computed. A
// lean JS fold (see gst-fold.ts for why), not a pipeline twin.
import { Order } from "@/models/Order";
import { getSettings, gstConfigOf } from "@/lib/settings";
import { currentWindow } from "@/lib/dashboard/range";
import { inWindow } from "@/lib/dashboard/pipelines";
import { foldGstReport } from "@/lib/reports/gst-fold";
import type { GstOrderView } from "@/lib/reports/gst-fold";
import type { DashboardRange } from "@/types/dashboard";
import type { GstReport } from "@/types/reports-b2";

const GST_ORDER_SELECT = "createdAt status total gstAmount gstRate gstMode chargeAmount billNumber orderId payment";

export async function buildGstReport(
  range: DashboardRange,
  now: Date = new Date(),
  opts: { bills?: boolean } = {},
): Promise<GstReport> {
  const current = currentWindow(range, now);

  const [orders, settings] = await Promise.all([
    Order.find({
      ...inWindow(current),
      $or: [{ status: "Completed" }, { status: "Cancelled", billNumber: { $exists: true } }],
    })
      .select(GST_ORDER_SELECT)
      .lean<GstOrderView[]>(),
    getSettings(),
  ]);

  const liveCfg = gstConfigOf(settings);
  return foldGstReport({ range, orders, liveCfg, withBills: opts.bills ?? false });
}
