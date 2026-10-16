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
import { hitRateLimit, pruneRateWindows, refundRateLimit } from "@/lib/public-rate-limit";
import { cafeDateString } from "@/lib/utils";
import { Staff } from "@/models/Staff";

// The PIN sign-in check on the server (spec 2026-10-16 §5.4), called by the "pin" Credentials
// provider in lib/auth.ts. Server-only (Mongoose models, node:crypto): never import from a
// "use client" file. Limits are per selected person only, never per network (the owner's rule),
// and only a wrong PIN stays counted.
//
// The order (controller ruling R7): the shape and the device are checked first and count nothing.
// Every try that passes them then takes a slot in the person's window with ONE atomic hit, BEFORE
// anything is read or compared, so a burst of parallel tries can never get more than 5 guesses
// into a window. A try the hit finds over the limit answers "wait"; then the staff row is read
// (nopin / blocked) and the PIN compared. Every answer but "wrong" hands its slot back
// (refundRateLimit), so the window ends up counting wrong PINs only; a wrong PIN keeps its slot
// and adds one to the person's day count (20 blocks).

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

/** Checks one PIN try for the person whose tile was chosen, in the order the header describes. */
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

  // The staff-PIN windows share publicratelimits with the QR order route, its only other reaper, so a
  // cafe without QR ordering would never prune them. Only a try that reached the database starts it:
  // the shape and device refusals above answer before connectDB, where a prune on an instance that
  // has not connected yet would buffer for 10 s. It runs beside the check and never rejects (it
  // swallows its own errors); the finally waits for it once the answer is known.
  const pruned = pruneRateWindows(now);
  try {
    // 3. Take a slot in the person's window before reading or comparing anything. Every answer below
    // except "wrong" is a definite non-wrong outcome and hands the slot back. A throw keeps it: a
    // refund is only made on a path that is surely returning (the never-revert-on-write-throw rule).
    const bucket = staffPinBucket(staffId);
    const hit = await hitRateLimit(bucket, STAFF_PIN_RATE_MAX, now);
    const handBack = async (failure: Exclude<PinSignInFailure, { kind: "offline" }>): Promise<PinSignInResult> => {
      await refundRateLimit(bucket, now);
      return { ok: false, failure };
    };
    if (!hit.allowed) return handBack({ kind: "wait", retryAfterSec: hit.retryAfterSec });

    // 4. The person: active, with a PIN, not blocked. A stored PIN the rules refuse counts as none
    // (the typed one passed them, so it could never match).
    const staff = await Staff.findOne({ _id: staffId, isActive: true })
      .select("+pin +pinFailDay +pinFailCount name role hasPin pinBlocked")
      .lean<PinStaffRow | null>();
    if (!staff || staff.hasPin !== true || !isValidStaffPin(staff.pin)) return handBack({ kind: "nopin" });
    if (staff.pinBlocked === true) return handBack({ kind: "blocked" });

    // 5. Constant time: both are exactly 4 ASCII digits here, so the buffers are equal in length.
    if (!timingSafeEqual(Buffer.from(staff.pin), Buffer.from(pin))) {
      // 6. Wrong: the slot stays taken, and the day count goes up.
      await recordWrongPin(staffId, cafeDateString(new Date(now)));
      return { ok: false, failure: { kind: "wrong", triesLeft: Math.max(0, STAFF_PIN_RATE_MAX - hit.n) } };
    }

    // 7. Right: the slot is handed back; the same user shape as the password provider.
    await refundRateLimit(bucket, now);
    return { ok: true, user: { id: String(staff._id), name: staff.name, role: staff.role } };
  } finally {
    await pruned;
  }
}
