/**
 * Part A of the staff PIN live leg: the PIN is stored and shown to admins, never listed, and
 * only an admin can read it. Raw collection reads are an independent path from the routes.
 */
import mongoose from "mongoose";
import { dataOf, rowsOf, type Harness } from "./verify-staff-pin-live-helpers";

const TOO_EASY = "Too easy to guess. Pick another PIN.";

function staffCol() {
  const db = mongoose.connection.db;
  if (!db) throw new Error("not connected");
  return db.collection("staffs");
}

export async function runPartA(h: Harness): Promise<void> {
  const { check } = h;
  h.setRole("admin");

  const made = await h.staff.create({
    name: "Pin Person",
    mobile: "9876543210",
    username: "pinperson",
    password: "secret123",
    role: "staff",
    pin: "7391",
  });
  const id = String(dataOf(made)._id ?? "");
  check(
    "POST with pin 7391 -> 201, hasPin true, no pin / pinFailCount / password key",
    made.status === 201 &&
      dataOf(made).hasPin === true &&
      !("pin" in dataOf(made)) &&
      !("pinFailCount" in dataOf(made)) &&
      !("password" in dataOf(made)),
    made,
  );

  const raw = await staffCol().findOne({ username: "pinperson" });
  check(
    "the stored row keeps the PIN, hasPin true, pinBlocked false",
    raw?.pin === "7391" && raw?.hasPin === true && raw?.pinBlocked === false,
  );

  const list = await h.staff.list();
  const row = rowsOf(list).find((r) => r.username === "pinperson");
  check(
    "GET /api/staff row has hasPin true and no pin / pinFailDay / pinFailCount key",
    list.status === 200 &&
      row?.hasPin === true &&
      !("pin" in (row ?? {})) &&
      !("pinFailDay" in (row ?? {})) &&
      !("pinFailCount" in (row ?? {})),
    list,
  );

  const shown = await h.staff.pin(id);
  check(
    "GET /api/staff/<id>/pin -> { pin: 7391 } with Cache-Control no-store",
    shown.status === 200 && dataOf(shown).pin === "7391" && shown.cacheControl === "no-store",
    shown,
  );

  const easy = await h.staff.update(id, { pin: "1234" });
  check(
    "PUT { pin: 1234 } -> 400 with the too-easy message",
    easy.status === 400 && JSON.stringify(easy.body).includes(TOO_EASY),
    easy,
  );

  // A blocked row with a count: a new PIN clears both, an unblock alone zeroes the count too.
  await staffCol().updateOne({ username: "pinperson" }, { $set: { pinBlocked: true, pinFailCount: 5 } });
  const unblock = await h.staff.update(id, { pinBlocked: false });
  const afterUnblock = await staffCol().findOne({ username: "pinperson" });
  check(
    "PUT { pinBlocked: false } -> 200, unblocked, count zeroed, PIN kept",
    unblock.status === 200 &&
      dataOf(unblock).pinBlocked === false &&
      afterUnblock?.pinBlocked === false &&
      afterUnblock?.pinFailCount === 0 &&
      afterUnblock?.pin === "7391",
    unblock,
  );

  await staffCol().updateOne({ username: "pinperson" }, { $set: { pinBlocked: true, pinFailCount: 5 } });
  const reset = await h.staff.update(id, { pin: "4072" });
  const afterReset = await staffCol().findOne({ username: "pinperson" });
  check(
    "PUT { pin: 4072 } -> 200, new PIN stored, hasPin true, unblocked, count zeroed, no pin in the body",
    reset.status === 200 &&
      !("pin" in dataOf(reset)) &&
      afterReset?.pin === "4072" &&
      afterReset?.hasPin === true &&
      afterReset?.pinBlocked === false &&
      afterReset?.pinFailCount === 0,
    reset,
  );

  const noPin = await h.staff.create({
    name: "No Pin",
    mobile: "9876543211",
    username: "nopin",
    password: "secret123",
    role: "staff",
  });
  const noPinId = String(dataOf(noPin)._id ?? "");
  const none = await h.staff.pin(noPinId);
  check(
    "a staff member with no PIN: hasPin false and GET /pin -> { pin: null }",
    noPin.status === 201 && dataOf(noPin).hasPin === false && none.status === 200 && dataOf(none).pin === null,
    none,
  );

  h.setRole("staff");
  const denied = await h.staff.pin(id);
  check(
    "as staff, GET /pin -> 403 and no PIN in the body",
    denied.status === 403 && !JSON.stringify(denied.body).includes("4072"),
    denied,
  );
  h.setRole("admin");
}
