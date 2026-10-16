/**
 * Part B of the staff PIN live leg: the PIN check itself (lib/staff-pin-signin.ts), called directly
 * against the real mongod (no route, no auth stub). Rows are seeded and read back through the raw
 * collections, an independent path from the module under test.
 */
import mongoose from "mongoose";
import { PUBLIC_ORDER_RATE_WINDOW_MS } from "@pos/shared/public";
import { STAFF_PIN_RATE_MAX, staffPinBucket } from "@pos/shared/staff-pin";
import { peekRateLimit } from "@/lib/public-rate-limit";
import { verifyStaffPinSignIn, type PinSignInResult } from "@/lib/staff-pin-signin";
import { cafeDateString } from "@/lib/utils";
import type { Harness } from "./verify-staff-pin-live-helpers";

const A = "665f0000000000000000c001"; // active, PIN 7391, staff
const B = "665f0000000000000000c002"; // inactive, PIN 5820
const C = "665f0000000000000000c003"; // active, no PIN (a row from before this release: no PIN keys at all)
const D = "665f0000000000000000c004"; // active, the same PIN as A, admin; no pinBlocked / pinFailCount keys
const PIN = "7391";
const B_PIN = "5820";
const WRONG = ["0001", "0002", "0003", "0004", "0005"];
const WINDOW_SECONDS = PUBLIC_ORDER_RATE_WINDOW_MS / 1000;
const BLOCK_EDGE = 19;

function col(name: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  return db.collection(name);
}

const oid = (id: string) => new mongoose.Types.ObjectId(id);
const show = (r: PinSignInResult) => JSON.stringify(r);
const failureOf = (r: PinSignInResult) => (r.ok ? null : r.failure);

async function seed(): Promise<void> {
  const base = { mobile: "9876500000", password: "not-a-real-hash", createdAt: new Date(), updatedAt: new Date() };
  const pinned = { hasPin: true, pinBlocked: false, pinFailCount: 0 };
  await col("staffs").insertMany([
    { ...base, _id: oid(A), name: "Asha Rao", username: "pinb-a", role: "staff", isActive: true, pin: PIN, ...pinned },
    { ...base, _id: oid(B), name: "Bala Iyer", username: "pinb-b", role: "staff", isActive: false, pin: B_PIN, ...pinned },
    { ...base, _id: oid(C), name: "Chitra Das", username: "pinb-c", role: "staff", isActive: true },
    { ...base, _id: oid(D), name: "Dev Shah", username: "pinb-d", role: "admin", isActive: true, pin: PIN, hasPin: true },
  ]);
}

async function staffRow(id: string) {
  return col("staffs").findOne({ _id: oid(id) });
}

async function resetBucket(id: string): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  await db.collection<{ _id: string }>("publicratelimits").deleteMany({ _id: { $regex: `^staffpin:${id}:` } });
}

export async function runPartB(h: Harness): Promise<void> {
  const { check } = h;
  console.log("\n  Part B - PIN sign-in check");
  await seed();
  const now = Date.now(); // one instant for the whole part: no window or day can roll mid-way
  const today = cafeDateString(new Date(now));
  const device = [A, B, C, D].map((id, i) => ({ id, at: now - i }));
  const tryPin = (staffId: unknown, pin: unknown, devicePeople = device) =>
    verifyStaffPinSignIn({ staffId, pin, devicePeople, now });

  const ok = await tryPin(A, PIN);
  check(
    "A with the right PIN -> ok with A's id, name and role",
    ok.ok && ok.user.id === A && ok.user.name === "Asha Rao" && ok.user.role === "staff",
  );
  if (!ok.ok) console.log(`    got ${show(ok)}`);

  const foreign = await tryPin(A, PIN, device.filter((p) => p.id !== A));
  const foreignWrong = await verifyStaffPinSignIn({ staffId: A, pin: WRONG[0], devicePeople: null, now });
  const afterForeign = await staffRow(A);
  check(
    "A on a device without A (right PIN, and a wrong PIN with no cookie) -> device; bucket and day count untouched",
    failureOf(foreign)?.kind === "device" &&
      failureOf(foreignWrong)?.kind === "device" &&
      (await peekRateLimit(staffPinBucket(A), now)) === 0 &&
      afterForeign?.pinFailCount === 0 &&
      afterForeign?.pinFailDay === undefined,
  );

  const inactive = await tryPin(B, B_PIN);
  const noPin = await tryPin(C, PIN);
  const badId = await tryPin("not-an-id", PIN);
  check(
    "B (inactive, right PIN) -> nopin; C (no PIN) -> nopin; a bad id string -> wrong",
    failureOf(inactive)?.kind === "nopin" && failureOf(noPin)?.kind === "nopin" && failureOf(badId)?.kind === "wrong",
  );
  if (failureOf(inactive)?.kind !== "nopin" || failureOf(noPin)?.kind !== "nopin") {
    console.log(`    got B ${show(inactive)}, C ${show(noPin)}`);
  }

  // Review Focus 5: the tile decides who signs in, never the PIN.
  const asA = await tryPin(A, PIN);
  const asD = await tryPin(D, PIN);
  check(
    "A and D share a PIN: A's tile signs in A, D's tile signs in D (an admin)",
    asA.ok && asA.user.id === A && asD.ok && asD.user.id === D && asD.user.role === "admin",
  );

  const left: number[] = [];
  for (const pin of WRONG) {
    const failure = failureOf(await tryPin(A, pin));
    left.push(failure?.kind === "wrong" ? failure.triesLeft : -1);
  }
  check(`five wrong PINs for A -> wrong with 4,3,2,1,0 tries left (got ${left.join(",")})`, left.join(",") === "4,3,2,1,0");

  const sixth = failureOf(await tryPin(A, PIN));
  const afterSix = await staffRow(A);
  check(
    `the sixth try, even the right PIN -> wait with 1..${WINDOW_SECONDS} s; the wait itself counts nothing`,
    sixth?.kind === "wait" &&
      sixth.retryAfterSec >= 1 &&
      sixth.retryAfterSec <= WINDOW_SECONDS &&
      (await peekRateLimit(staffPinBucket(A), now)) === STAFF_PIN_RATE_MAX &&
      afterSix?.pinFailCount === WRONG.length &&
      afterSix?.pinFailDay === today,
  );
  if (sixth?.kind !== "wait") console.log(`    got ${JSON.stringify(sixth)}`);

  await resetBucket(A);
  await col("staffs").updateOne({ _id: oid(A) }, { $set: { pinFailDay: today, pinFailCount: BLOCK_EDGE } });
  const twentieth = failureOf(await tryPin(A, WRONG[0]));
  const afterBlock = await staffRow(A);
  check(
    "A at 19 wrong today, one more wrong PIN -> wrong, and the row is blocked at 20",
    twentieth?.kind === "wrong" && afterBlock?.pinBlocked === true && afterBlock?.pinFailCount === BLOCK_EDGE + 1,
  );
  const blocked = failureOf(await tryPin(A, PIN));
  check("the next try for A, even the right PIN -> blocked", blocked?.kind === "blocked");

  // The atomic update on a row with no count or block keys: missing reads as 0 / false.
  const firstD = failureOf(await tryPin(D, WRONG[0]));
  const afterFirstD = await staffRow(D);
  check(
    "D (no count or block keys stored), one wrong PIN -> wrong with 4 left; today, count 1, pinBlocked false",
    firstD?.kind === "wrong" &&
      firstD.triesLeft === STAFF_PIN_RATE_MAX - 1 &&
      afterFirstD?.pinFailDay === today &&
      afterFirstD?.pinFailCount === 1 &&
      afterFirstD?.pinBlocked === false,
  );

  // The atomic update's day rule (the same as nextPinFailState): an old day's count does not carry over.
  await resetBucket(D);
  await col("staffs").updateOne({ _id: oid(D) }, { $set: { pinFailDay: "2000-01-01", pinFailCount: BLOCK_EDGE } });
  const newDay = failureOf(await tryPin(D, WRONG[0]));
  const afterNewDay = await staffRow(D);
  const dStill = await tryPin(D, PIN);
  check(
    "D at 19 on an old day, one wrong PIN -> today, count 1, not blocked; D's right PIN still signs in",
    newDay?.kind === "wrong" &&
      afterNewDay?.pinFailDay === today &&
      afterNewDay?.pinFailCount === 1 &&
      afterNewDay?.pinBlocked === false &&
      dStill.ok,
  );
}
