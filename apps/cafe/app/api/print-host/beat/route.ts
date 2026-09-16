import { z } from "zod";
import { connectDB } from "@/lib/db";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS, beatPrintHost } from "@/lib/print-host";
import { success, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

// `silentProbeMs` carries no upper bound: it is a raw probe measurement,
// server-side only, never compared against a threshold until §E R6 measures a
// real `dt` on the cafe PC. It is `.int()` because a fractional configured
// value rounds when stored, not when re-derived, and a strict re-derive
// compare against a fractional value deadlocks forever (memory
// rounding-vs-strict-compare-deadlock).
const beatBodySchema = z
  .object({
    deviceId: z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS),
    silentMode: z.boolean().optional(),
    silentProbeMs: z.number().int().nonnegative().optional(),
  })
  .strict();

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
