import mongoose from "mongoose";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { claimPrintJob, PRINT_HOST_TAB_ID_MAX_CHARS } from "@/lib/print-queue-claim";
import { PRINT_HOST_DEVICE_ID_MAX_CHARS } from "@/lib/print-host";
import { success, failure, requireAuth, serverError, validateBody } from "@/lib/api-helpers";
import { noStore } from "@/lib/order-request-tray";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// Staff name fallback for a nullish session name (Mongoose fields stamped
// from it are `required:true`, and a "" would 500 the save — memory
// mongoose-required-rejects-empty-string). Mirrors the sibling print-jobs/
// print-host routes' own UNNAMED_STAFF constant.
const UNNAMED_STAFF = "Staff";

// Both `.min(1)` are load-bearing: `claimedBy` is `${deviceId}:${tabId}` and
// an empty half makes two windows on the same PC indistinguishable.
const claimBodySchema = z
  .object({
    deviceId: z.string().trim().min(1).max(PRINT_HOST_DEVICE_ID_MAX_CHARS),
    tabId: z.string().trim().min(1).max(PRINT_HOST_TAB_ID_MAX_CHARS),
  })
  .strict();

// POST /api/print-jobs/[id]/claim (print-host plan §B2/§B5) — the drain's
// claim CAS. `not-host` / `raced` / `not-eligible` are all NORMAL 200
// outcomes (the drain must not error-toast them), mirroring
// `claimKotPrint`'s contract. No prune here — the claim is the hottest write
// on the host and must stay one CAS.
export async function POST(req: Request, { params }: Params) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return noStore(failure("Print job not found", 404));

  const parsed = await validateBody(req, claimBodySchema);
  if ("error" in parsed) return parsed.error;

  const dismissedBy = authed.session.user.name ?? UNNAMED_STAFF;

  try {
    await connectDB();
    const result = await claimPrintJob({ id, deviceId: parsed.data.deviceId, tabId: parsed.data.tabId, dismissedBy });
    return noStore(success(result));
  } catch (error) {
    return noStore(serverError("Failed to claim print job", error));
  }
}
