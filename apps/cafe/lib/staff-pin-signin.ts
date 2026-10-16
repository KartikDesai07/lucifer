import { timingSafeEqual } from "node:crypto";
import { isObjectIdString } from "@pos/shared/schemas/object-id.schema";
import {
  STAFF_PIN_DAILY_BLOCK,
  STAFF_PIN_RATE_MAX,
  isValidStaffPin,
  staffPinBucket,
  type PinSignInFailure,
} from "@pos/shared/staff-pin";
import { connectDB } from "@/lib/db";
import type { PinDevicePerson } from "@/lib/pin-device";
import { hitRateLimit, peekRateLimit, rateLimitDecision } from "@/lib/public-rate-limit";
import { cafeDateString } from "@/lib/utils";
import { Staff } from "@/models/Staff";

// The PIN sign-in check on the server (spec 2026-10-16 §5.4), called by the "pin" Credentials
// provider in lib/auth.ts. Server-only (Mongoose models, node:crypto): never import from a
// "use client" file. Limits are per selected person only, never per network (the owner's rule),
// and only a wrong PIN is counted.

export type PinSignInResult =
  | { ok: true; user: { id: string; name: string; role: "admin" | "staff" } }
  | { ok: false; failure: Exclude<PinSignInFailure, { kind: "offline" }> };

export type PinFailState = { day: string; count: number; block: boolean };

// A shape failure is not counted and may carry no valid id, so it shows no count ("Incorrect PIN").
const SHAPE_FAILURE: PinSignInResult = { ok: false, failure: { kind: "wrong", triesLeft: 0 } };

/**
 * The day count after one more wrong PIN: a new cafe day starts again at 1; reaching `blockAt`
 * blocks the PIN. Pure. The atomic update in recordWrongPin below applies the same rule inside
 * Mongo: the two must stay equal.
 */
export function nextPinFailState(
  prev: { day?: string; count: number },
  today: string,
  blockAt = STAFF_PIN_DAILY_BLOCK,
): PinFailState {
  const count = prev.day === today ? prev.count + 1 : 1;
  return { day: today, count, block: count >= blockAt };
}

// One atomic update (a pipeline, so the new count is computed from the stored one in the same
// write): two wrong PINs at once can never both read 19 and miss the block. Must stay equal to
// nextPinFailState. A missing count (a row from before this release) reads as 0, a missing
// pinBlocked as false; a block is never lifted here (only an admin lifts it).
async function recordWrongPin(staffId: string, today: string): Promise<void> {
  await Staff.findOneAndUpdate(
    { _id: staffId },
    [
      {
        $set: {
          pinFailCount: {
            $cond: [{ $eq: ["$pinFailDay", today] }, { $add: [{ $ifNull: ["$pinFailCount", 0] }, 1] }, 1],
          },
          pinFailDay: today,
        },
      },
      {
        $set: {
          pinBlocked: {
            $cond: [{ $gte: ["$pinFailCount", STAFF_PIN_DAILY_BLOCK] }, true, { $ifNull: ["$pinBlocked", false] }],
          },
        },
      },
    ],
    { projection: { _id: 1 } },
  ).lean();
}

type PinStaffRow = {
  _id: unknown;
  name: string;
  role: "admin" | "staff";
  pin?: string;
  hasPin?: boolean;
  pinBlocked?: boolean;
};

/** Checks one PIN try for the person whose tile was chosen, in the spec's order. */
export async function verifyStaffPinSignIn(input: {
  staffId: unknown;
  pin: unknown;
  devicePeople: PinDevicePerson[] | null;
  now?: number;
}): Promise<PinSignInResult> {
  const { staffId, pin, devicePeople } = input;
  const now = input.now ?? Date.now();

  // 1. Shape: nothing counted.
  if (!isObjectIdString(staffId) || !isValidStaffPin(pin)) return SHAPE_FAILURE;

  // 2. The device must have had this person sign in with a password: nothing counted.
  if (!devicePeople?.some((person) => person.id === staffId)) return { ok: false, failure: { kind: "device" } };

  await connectDB();

  // 3. A full window waits, whatever PIN was typed.
  const bucket = staffPinBucket(staffId);
  const used = await peekRateLimit(bucket, now);
  if (used >= STAFF_PIN_RATE_MAX) {
    const { retryAfterSec } = rateLimitDecision(STAFF_PIN_RATE_MAX + 1, STAFF_PIN_RATE_MAX, now);
    return { ok: false, failure: { kind: "wait", retryAfterSec } };
  }

  // 4. The person: active, with a PIN, not blocked. A stored PIN the rules refuse counts as none
  // (the typed one passed them, so it could never match).
  const staff = await Staff.findOne({ _id: staffId, isActive: true })
    .select("+pin +pinFailDay +pinFailCount name role hasPin pinBlocked")
    .lean<PinStaffRow | null>();
  if (!staff || staff.hasPin !== true || !isValidStaffPin(staff.pin)) return { ok: false, failure: { kind: "nopin" } };
  if (staff.pinBlocked === true) return { ok: false, failure: { kind: "blocked" } };

  // 5. Constant time: both are exactly 4 ASCII digits here, so the buffers are equal in length.
  if (!timingSafeEqual(Buffer.from(staff.pin), Buffer.from(pin))) {
    // 6. Wrong: the window and the day count. hitRateLimit gives no count back, so the count after
    // this hit is the peeked one plus this hit (or over the limit when concurrent tries filled it).
    const { allowed } = await hitRateLimit(bucket, STAFF_PIN_RATE_MAX, now);
    await recordWrongPin(staffId, cafeDateString(new Date(now)));
    const n = allowed ? used + 1 : STAFF_PIN_RATE_MAX + 1;
    return { ok: false, failure: { kind: "wrong", triesLeft: Math.max(0, STAFF_PIN_RATE_MAX - n) } };
  }

  // 7. Right: the same user shape as the password provider.
  return { ok: true, user: { id: String(staff._id), name: staff.name, role: staff.role } };
}
