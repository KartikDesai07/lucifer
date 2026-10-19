import type { NextResponse } from "next/server";

import { encodePinFailure } from "@pos/shared/staff-pin";
import { requireAuth, serverError, success } from "@/lib/api-helpers";
import { verifyOwnStaffPin } from "@/lib/staff-pin-signin";

export const dynamic = "force-dynamic";

// POST /api/sign-in/verify-pin { pin } — the dashboard's sales reveal (U0 match Task 6, design 7): is this the
// signed-in person's own PIN? Session-guarded, and the person comes only from the session (a body naming somebody
// else is never read), so a page can only ever check its own person's PIN. The check is the PIN sign-in's own
// (lib/staff-pin-signin.ts verifyOwnStaffPin): the same per-person window and day count, so a wrong PIN here is a
// wrong PIN there. It answers { ok: true } or { ok: false, code } with the sign-in's codes ("wrong:3", "wait:540",
// "blocked", "nopin"); it names no secret and signs nobody in. no-store: the answer is about a person's PIN.

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: Request) {
  const guard = await requireAuth();
  if ("error" in guard) return noStore(guard.error);

  // Anything but { pin: "dddd" } fails the check's shape step, which counts nothing.
  const body: unknown = await req.json().catch(() => null);
  const pin = body !== null && typeof body === "object" ? (body as { pin?: unknown }).pin : undefined;

  try {
    const result = await verifyOwnStaffPin({ staffId: guard.session.user.id, pin });
    return noStore(success(result.ok ? { ok: true } : { ok: false, code: encodePinFailure(result.failure) }));
  } catch (error) {
    return noStore(serverError("Couldn't check the PIN", error));
  }
}
