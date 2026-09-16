import { connectDB } from "@/lib/db";
import { printJobDrainHead } from "@/lib/print-queue-feeds";
import { success, requireAuth, serverError } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// GET /api/print-jobs/wake (CB-U1) — an EXPLICIT amendment, not a silent
// override, of print-host-plan.md §B4 / order-requests/pulse/route.ts's own
// pinned invariant ("no second 20s poll from every open tab"): this endpoint
// is polled by exactly ONE tab — the lock-holding draining print host — and
// answers with a pending flag plus the newest pending job's id — a change
// signal, no payload. The alternative (a flat 3s poll from every open tab)
// blows the Vercel Hobby invocation budget; see cb-u1-wake-and-session-plan.md's
// arithmetic.
//
// READ-ONLY, always: no prune, no beat, no write, ever — the same invariant
// pulse/route.ts pins for itself applies identically here.
//
// Body is exactly one query: printJobDrainHead's index-backed read (rides
// {status:1,createdAt:1,_id:1}), sharing printJobDrainFilter with the D1
// drain read so the two can never disagree on "pending".
export async function GET() {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  try {
    await connectDB();
    const head = await printJobDrainHead(Date.now());
    return noStore(success(head));
  } catch (error) {
    return noStore(serverError("Failed to read print queue state", error));
  }
}
