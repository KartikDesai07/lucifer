import { after } from "next/server";
import { connectDB } from "@/lib/db";
import { readPosPulse } from "@/lib/pos-pulse";
import { printPulseDeviceOf } from "@/lib/print-agent-server";
import { readPrintAttention } from "@/lib/print-attention";
import { readJobsForDevice } from "@/lib/print-lease";
import { sweepPrintJobsThrottled } from "@/lib/print-sweep";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// GET /api/order-requests/pulse (CR2.3 §20) — the staff-attention pulse every
// dashboard tab polls every 20s (PosPulseProvider), replacing the old sidebar
// badge poll one-for-one so requests/min is unchanged.
//
// Threat model: authenticated staff-only (requireAuth, same as every sibling
// under /api/order-requests), READ-ONLY (no write, no pruneOrderRequests —
// see lib/pos-pulse.ts's own comment), and never cached (live state, exactly
// like /api/order-requests and /api/orders). Being a hot path is exactly why
// it must stay bounded index-backed queries and nothing else — this route
// must never grow a write.
//
// AMENDMENT (print-host plan §B4, explicit, not a silent override): the
// pulse now serves SIX bounded index-backed reads (2 OrderRequest + PrintHost
// + the D1/D2/D3 print-job feeds), not two — the alternative was a second
// 20s poll from every open tab for host/queue state, strictly worse for the
// free tier. The invariant that survives unchanged, and is still pinned, is
// that this route performs NO WRITE (no pruneOrderRequests, no
// prunePrintJobs/prunePrintJobsThrottled) and stays no-store.
//
// Printing Phase 1 Session 1C (spec §9.1): an agent tab names itself (?device=<id>) and the answer adds
// printJobsForMe, the jobs waiting in that device's own line, so a job the server re-queued or sent
// home reaches its agent within one tick even with the socket down. One more bounded, index-backed
// READ on a poll that already runs (no new request), fail-soft: a failed read omits the field.
//
// Printing Phase 1 Session 1D (spec §10, §17.3 rule 2): every tab also reads the waiting-slips feed (one
// bounded read: the panel, its count, the 20 s alarm), and the pulse runs the print sweep AFTER its
// answer, at most once per 60 s per instance (sweepPrintJobsThrottled). With no host nothing else runs
// it: lease expiry, sending jobs home and the KOT repair would otherwise never happen. The route itself
// still writes nothing; the sweep's writes are the sweep's (lib/print-sweep.ts), never on this answer.
export async function GET(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const device = printPulseDeviceOf(req.url);

  try {
    await connectDB();
    const nowMs = Date.now();
    const [data, printJobsForMe, attention] = await Promise.all([
      readPosPulse(),
      device === null ? Promise.resolve(null) : readJobsForDevice(device, nowMs).catch(() => null),
      readPrintAttention(nowMs).catch(() => null),
    ]);
    try {
      after(() => sweepPrintJobsThrottled(nowMs));
    } catch {
      // no after() in this runtime: skip the sweep, keep the pulse
    }
    return noStore(
      success({
        ...data,
        ...(printJobsForMe === null ? {} : { printJobsForMe }),
        ...(attention === null ? {} : { printAttention: attention.rows, printAttentionTruncated: attention.truncated }),
      }),
    );
  } catch (error) {
    return noStore(serverError("Failed to fetch pos pulse", error));
  }
}
