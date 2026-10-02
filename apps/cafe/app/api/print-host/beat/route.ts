import { connectDB } from "@/lib/db";
import { beatPrintHost } from "@/lib/print-host";
import { beatBodySchema } from "@/lib/print-host-beat-schema";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// POST /api/print-host/beat (print-host plan §B3) — fired once per successful
// pulse fetch. This is a POST, not a GET, precisely because the pulse GET
// must stay read-only (pinned by lib/self-order-alert-paths.test.ts), and it
// is CAS-bound to `deviceId` so a demoted device's stale beat can never
// resurrect the silentMode/silentProbeMs a designation `$unset`.
export async function POST(req: Request) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const parsed = await validateBody(req, beatBodySchema);
  if ("error" in parsed) return parsed.error;

  const nowMs = Date.now();

  try {
    await connectDB();
    const result = await beatPrintHost(
      {
        deviceId: parsed.data.deviceId,
        silentMode: parsed.data.silentMode,
        silentProbeMs: parsed.data.silentProbeMs,
        printer: parsed.data.printer,
      },
      nowMs,
    );

    // On {isHost:false} a non-host beat writes nothing and must cost nothing
    // (MERGED-07) — the device clears its local pref and stops beating off
    // this answer. No prune on either outcome: the beat fires every 20s and
    // the enqueue/PUT/DELETE paths already own retention.
    if (!result.isHost) return noStore(success({ isHost: false }));
    return noStore(success({ isHost: true, state: result.state }));
  } catch (error) {
    return noStore(serverError("Failed to beat the print host", error));
  }
}
