/**
 * Part E of the staff PIN live leg: the sales reveal's own-PIN check (U0 match Task 6, design 7), through the REAL
 * POST /api/sign-in/verify-pin handler. auth() is the harness's stub (signInAs). The route checks the signed-in
 * person's own PIN in the SAME per-person window and day count as a PIN sign-in, so a wrong PIN here shows in the
 * window the sign-in reads (lib/staff-pin-signin.ts verifyStaffPinSignIn, called directly beside it). Rows are seeded
 * and read back through the raw collections, an independent path from the module under test.
 */
import mongoose from "mongoose";
import { STAFF_PIN_RATE_MAX } from "@pos/shared/staff-pin";
import { verifyStaffPinSignIn } from "@/lib/staff-pin-signin";
import { cafeDateString } from "@/lib/utils";
import { dataOf, type Harness, type RouteRes, type StubUser } from "./verify-staff-pin-live-helpers";

const A = "665f0000000000000000e001"; // active staff, PIN 4826
const B = "665f0000000000000000e002"; // active staff, no PIN
const C = "665f0000000000000000e003"; // active admin, PIN 3907: a body naming C must never check C
const D = "665f0000000000000000e004"; // active staff, PIN 5174, blocked
const A_PIN = "4826";
const C_PIN = "3907";
const WRONG = ["0011", "0012", "0013", "0014"];

const ASHA: StubUser = { id: A, name: "Asha Rao", role: "staff" };
const BALA: StubUser = { id: B, name: "Bala Iyer", role: "staff" };
const DEV: StubUser = { id: D, name: "Dev Shah", role: "staff" };

function db() {
  const conn = mongoose.connection.db;
  if (!conn) throw new Error("not connected");
  return conn;
}
const oid = (id: string) => new mongoose.Types.ObjectId(id);
const staffRow = (id: string) => db().collection("staffs").findOne({ _id: oid(id) });

/** Every window row of this person's bucket summed: robust if a 10-minute window rolls over mid-part. */
async function used(id: string): Promise<number> {
  const rows = await db()
    .collection<{ _id: string; n: number }>("publicratelimits")
    .find({ _id: { $regex: `^staffpin:${id}:` } })
    .toArray();
  return rows.reduce((sum, row) => sum + row.n, 0);
}

async function seed(): Promise<void> {
  const base = { mobile: "9876500000", password: "not-a-real-hash", createdAt: new Date(), updatedAt: new Date() };
  const pinned = { hasPin: true, pinBlocked: false, pinFailCount: 0 };
  await db().collection("staffs").insertMany([
    { ...base, _id: oid(A), name: ASHA.name, username: "pine-a", role: "staff", isActive: true, pin: A_PIN, ...pinned },
    { ...base, _id: oid(B), name: BALA.name, username: "pine-b", role: "staff", isActive: true, hasPin: false, pinBlocked: false },
    { ...base, _id: oid(C), name: "Chitra Das", username: "pine-c", role: "admin", isActive: true, pin: C_PIN, ...pinned },
    { ...base, _id: oid(D), name: DEV.name, username: "pine-d", role: "staff", isActive: true, pin: "5174", ...pinned, pinBlocked: true },
  ]);
}

const answer = (res: RouteRes) => dataOf(res) as { ok?: unknown; code?: unknown; state?: unknown };

export async function runPartE(h: Harness): Promise<void> {
  const { check } = h;
  console.log("\n  Part E - the sales reveal's own-PIN check (POST /api/sign-in/verify-pin)");
  await seed();
  const today = cafeDateString(new Date());
  const verify = (body?: unknown) => h.signInRoutes.verifyPin(body);

  h.signInAs(null);
  const signedOut = await verify({ pin: A_PIN });
  check(
    "signed out -> 401, nothing counted, no-store",
    signedOut.status === 401 && (await used(A)) === 0 && signedOut.cacheControl === "no-store",
    signedOut,
  );

  h.signInAs(ASHA);
  const right = await verify({ pin: A_PIN });
  check(
    "Asha signed in, her own right PIN -> 200 { ok: true }, the slot handed back (window 0), no-store",
    right.status === 200 && answer(right).ok === true && (await used(A)) === 0 && right.cacheControl === "no-store",
    right,
  );

  const wrong = await verify({ pin: WRONG[0] });
  const afterWrong = await staffRow(A);
  check(
    `a wrong PIN -> { ok: false, code: "wrong:${STAFF_PIN_RATE_MAX - 1}" }; the window keeps it (1) and the day count is 1 today`,
    wrong.status === 200 &&
      answer(wrong).ok === false &&
      answer(wrong).code === `wrong:${STAFF_PIN_RATE_MAX - 1}` &&
      (await used(A)) === 1 &&
      afterWrong?.pinFailCount === 1 &&
      afterWrong?.pinFailDay === today,
    wrong,
  );

  // Review Focus 4: the same per-person window as the PIN sign-in, both ways.
  const signInWrong = await verifyStaffPinSignIn({ staffId: A, pin: WRONG[1], devicePeople: [{ id: A, at: 1 }] });
  const signInLeft = signInWrong.ok || signInWrong.failure.kind !== "wrong" ? -1 : signInWrong.failure.triesLeft;
  check(
    `the reveal's wrong PIN shows in the PIN sign-in's window: a wrong sign-in next has ${STAFF_PIN_RATE_MAX - 2} tries left (got ${signInLeft})`,
    signInLeft === STAFF_PIN_RATE_MAX - 2 && (await used(A)) === 2,
  );
  const afterSignIn = await verify({ pin: WRONG[2] });
  check(
    `and the sign-in's wrong PIN shows in the reveal's: the next wrong reveal says wrong:${STAFF_PIN_RATE_MAX - 3}; the day count is 3`,
    answer(afterSignIn).code === `wrong:${STAFF_PIN_RATE_MAX - 3}` && (await staffRow(A))?.pinFailCount === 3,
    afterSignIn,
  );

  // The person comes from the session only: a body naming someone else checks the signed-in person.
  const usedC = await used(C);
  const named = await verify({ pin: C_PIN, staffId: C });
  check(
    "a body naming another person (their right PIN) still checks Asha: wrong, Asha's window 4, the named person untouched",
    answer(named).ok === false &&
      String(answer(named).code).startsWith("wrong:") &&
      (await used(A)) === 4 &&
      (await used(C)) === usedC &&
      (await staffRow(C))?.pinFailCount === 0,
    named,
  );

  const fifth = await verify({ pin: WRONG[3] });
  const sixth = await verify({ pin: A_PIN });
  check(
    "the window's 5th wrong -> wrong:0; then even the right PIN -> wait (shared limit), nothing more counted",
    answer(fifth).code === "wrong:0" &&
      String(answer(sixth).code).startsWith("wait:") &&
      (await used(A)) === STAFF_PIN_RATE_MAX &&
      (await staffRow(A))?.pinFailCount === STAFF_PIN_RATE_MAX,
    sixth,
  );

  h.signInAs(BALA);
  const noPin = await verify({ pin: A_PIN });
  check("Bala (no PIN set) -> nopin, the slot handed back", answer(noPin).code === "nopin" && (await used(B)) === 0, noPin);

  const shapes = [await verify({ pin: "12" }), await verify({ pin: 4826 }), await verify(), await verify({ pin: "1111" })];
  check(
    "a bad shape (two digits, a number, no body, an easy PIN) -> wrong:0, nothing counted",
    shapes.every((r) => r.status === 200 && answer(r).code === "wrong:0") && (await used(B)) === 0 && (await staffRow(B))?.pinFailCount === undefined,
    shapes[2],
  );

  // Task 6 fix 1: the dialog's up-front look-up, { check: true }: read-only, no slot, no compare, no count.
  h.signInAs(null);
  const checkedOut = await verify({ check: true });
  check("check mode signed out -> 401, no-store", checkedOut.status === 401 && checkedOut.cacheControl === "no-store", checkedOut);
  h.signInAs(ASHA);
  const asha = await staffRow(A);
  const ready = await verify({ check: true, pin: A_PIN });
  check(
    `check mode for Asha (her window full) -> { state: "ready" }; the window stays ${STAFF_PIN_RATE_MAX} and the day count ${STAFF_PIN_RATE_MAX}, no-store`,
    ready.status === 200 &&
      answer(ready).state === "ready" &&
      answer(ready).ok === undefined &&
      (await used(A)) === STAFF_PIN_RATE_MAX &&
      (await staffRow(A))?.pinFailCount === asha?.pinFailCount &&
      ready.cacheControl === "no-store",
    ready,
  );
  h.signInAs(BALA);
  const none = await verify({ check: true });
  check("check mode for Bala (no PIN) -> nopin, nothing counted", answer(none).state === "nopin" && (await used(B)) === 0, none);
  h.signInAs(DEV);
  const blocked = await verify({ check: true });
  check("check mode for Dev (a blocked PIN) -> blocked, nothing counted", answer(blocked).state === "blocked" && (await used(D)) === 0, blocked);
}
