import { cookies } from "next/headers";

import { PIN_DEVICE_COOKIE } from "@pos/shared/staff-pin";
import { requireAuth, success } from "@/lib/api-helpers";
import {
  pinDeviceCookieOptions,
  pinDeviceKey,
  readPinDevice,
  rememberPerson,
  signPinDevice,
} from "@/lib/pin-device";

export const dynamic = "force-dynamic";

// The cookie may only carry ids it can read back: anything else would make every later read refuse
// the whole cookie (lib/pin-device.ts readPinDevice), and the device would forget everyone.
const SESSION_ID = /^[0-9a-f]{24}$/;

// POST /api/sign-in/remember — this device remembers the signed-in person for PIN sign-in (spec
// 2026-10-16 §5.2-5.3). The page calls it once after each sign-in; the session's person moves to the
// front of the signed device cookie with the time, and the cookie is re-issued for another 400 days.
// Session-guarded, and the person comes only from the session, so a page can never make a device
// remember somebody else. With no signing key it remembers nothing (and says so).
export async function POST() {
  const guard = await requireAuth();
  if ("error" in guard) return guard.error;

  const key = pinDeviceKey(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET);
  const id = guard.session.user.id;
  if (!key || typeof id !== "string" || !SESSION_ID.test(id)) return success({ remembered: false });

  const jar = await cookies();
  const people = rememberPerson(readPinDevice(jar.get(PIN_DEVICE_COOKIE)?.value, key), id, Date.now());
  jar.set(PIN_DEVICE_COOKIE, signPinDevice(people, key), pinDeviceCookieOptions());
  return success({ remembered: true });
}
