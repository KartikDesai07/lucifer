import assert from "node:assert/strict";
import { test } from "node:test";
import { STAFF_PIN_RATE_MAX } from "@pos/shared/staff-pin";
import { PublicRateLimit } from "@/models/PublicRateLimit";
import { Staff } from "@/models/Staff";
import type { PinDevicePerson } from "./pin-device";
import { nextPinFailState, ownStaffPinState, verifyOwnStaffPin, verifyStaffPinSignIn } from "./staff-pin-signin";

// Counts the rate-window prune's deleteMany calls while `run` runs. A prune on an instance that has
// not connected yet buffers for 10 s before it fails, so a refusal that answers before connectDB()
// must never reach it (Task 11 review).
async function prunesDuring(run: () => Promise<void>): Promise<number> {
  const model = PublicRateLimit as unknown as { deleteMany: (...args: unknown[]) => unknown };
  const real = model.deleteMany;
  let calls = 0;
  model.deleteMany = () => {
    calls += 1;
    return Promise.resolve({ deletedCount: 0 });
  };
  try {
    await run();
  } finally {
    model.deleteMany = real;
  }
  return calls;
}

// The pure half of the PIN sign-in check (spec 2026-10-16 §5.4). The database half (the per-person
// window, the atomic day count, the block) is driven against a real mongod by part B of
// scripts/verify-staff-pin-live.ts.

const TODAY = "2026-10-16";
const A = "665f0000000000000000c001";

test("nextPinFailState: the first wrong PIN of a day starts the count at 1", () => {
  assert.deepEqual(
    nextPinFailState({ count: 0 }, TODAY),
    { day: TODAY, count: 1, block: false },
    "no day yet -> today, count 1, not blocked",
  );
});

test("nextPinFailState: the 20th wrong PIN on the same day blocks", () => {
  assert.deepEqual(
    nextPinFailState({ day: TODAY, count: 19 }, TODAY),
    { day: TODAY, count: 20, block: true },
    "same day 19 -> 20 and blocked",
  );
  assert.deepEqual(
    nextPinFailState({ day: TODAY, count: 18 }, TODAY),
    { day: TODAY, count: 19, block: false },
    "same day 18 -> 19, not blocked yet",
  );
});

test("nextPinFailState: a new cafe day starts again at 1", () => {
  assert.deepEqual(
    nextPinFailState({ day: "2026-10-15", count: 19 }, TODAY),
    { day: TODAY, count: 1, block: false },
    "yesterday's 19 does not carry over",
  );
});

test("nextPinFailState: the block threshold can be passed in", () => {
  assert.equal(nextPinFailState({ day: TODAY, count: 2 }, TODAY, 3).block, true, "3rd of a 3-limit blocks");
  assert.equal(nextPinFailState({ day: TODAY, count: 1 }, TODAY, 3).block, false, "2nd of a 3-limit does not");
});

// With no MONGODB_URI, connectDB() rejects at once: these answers must come before any database work,
// which is what "nothing is counted" for a shape or a device failure rests on.
test("verifyStaffPinSignIn: a bad shape answers wrong without touching the database", async () => {
  delete process.env.MONGODB_URI;
  const device = [{ id: A, at: 1 }];
  const shapes: Array<[string, unknown, unknown]> = [
    ["an id that is not 24 hex", "not-an-id", "7391"],
    ["an upper-case id", A.toUpperCase(), "7391"],
    ["a number for an id", 42, "7391"],
    ["three digits", A, "739"],
    ["a letter in the PIN", A, "73a1"],
    ["a number for a PIN", A, 7391],
    ["no PIN", A, undefined],
  ];
  const prunes = await prunesDuring(async () => {
    for (const [label, staffId, pin] of shapes) {
      const result = await verifyStaffPinSignIn({ staffId, pin, devicePeople: device });
      assert.deepEqual(result, { ok: false, failure: { kind: "wrong", triesLeft: 0 } }, `${label} -> wrong, no count shown`);
    }
  });
  assert.equal(prunes, 0, "a bad shape never runs the rate-window prune (it answers before connectDB)");
});

test("verifyStaffPinSignIn: a device that never had this person sign in answers device without touching the database", async () => {
  delete process.env.MONGODB_URI;
  const devices: Array<[string, PinDevicePerson[] | null]> = [
    ["no device cookie", null],
    ["an empty device", []],
    ["a device that knows someone else", [{ id: "665f0000000000000000c002", at: 1 }]],
  ];
  const prunes = await prunesDuring(async () => {
    for (const [label, devicePeople] of devices) {
      const result = await verifyStaffPinSignIn({ staffId: A, pin: "7391", devicePeople });
      assert.deepEqual(result, { ok: false, failure: { kind: "device" } }, `${label} -> device`);
    }
  });
  assert.equal(prunes, 0, "a device refusal never runs the rate-window prune (it answers before connectDB)");
});

// ── verifyOwnStaffPin: the sales reveal's own-PIN check (U0 match Task 6, design 7) ─────────────────────────────────
// The signed-in person's own PIN, counted in the SAME per-person window and day count as a PIN sign-in, in the same
// order without the device check: shape -> a slot in the window -> the person -> a constant-time compare -> a wrong
// PIN keeps its slot and counts the day, every other answer hands the slot back. The database is a small in-memory
// stand-in here (the model calls the check makes), so the order of the calls is visible; part E of
// scripts/verify-staff-pin-live.ts drives the same check through the route against a real mongod.

type Row = { _id: string; name: string; role: "admin" | "staff"; isActive: boolean; pin?: string; hasPin?: boolean; pinBlocked?: boolean; pinFailCount?: number };

interface FakeDb {
  calls: string[];
  window: number;
  row: Row | null;
}

async function withFakeDb(start: { window?: number; row: Row | null }, run: (db: FakeDb) => Promise<void>): Promise<void> {
  const db: FakeDb = { calls: [], window: start.window ?? 0, row: start.row };
  const rate = PublicRateLimit as unknown as Record<string, unknown>;
  const staff = Staff as unknown as Record<string, unknown>;
  const saved = {
    findOneAndUpdate: rate.findOneAndUpdate,
    updateOne: rate.updateOne,
    deleteMany: rate.deleteMany,
    staffFindOne: staff.findOne,
    staffFindOneAndUpdate: staff.findOneAndUpdate,
  };
  rate.findOneAndUpdate = () => ({
    lean: async () => {
      db.calls.push("slot");
      db.window += 1;
      return { n: db.window };
    },
  });
  rate.updateOne = async () => {
    db.calls.push("refund");
    if (db.window > 0) db.window -= 1;
    return { modifiedCount: 1 };
  };
  rate.deleteMany = async () => ({ deletedCount: 0 });
  staff.findOne = (filter: { _id: string; isActive: boolean }) => ({
    select: () => ({
      lean: async () => {
        db.calls.push("read");
        const r = db.row;
        return r && r._id === filter._id && r.isActive === filter.isActive ? { ...r } : null;
      },
    }),
  });
  staff.findOneAndUpdate = () => ({
    lean: async () => {
      db.calls.push("count-day");
      if (db.row) db.row.pinFailCount = (db.row.pinFailCount ?? 0) + 1;
      return {};
    },
  });
  // connectDB() answers at once from its cached connection.
  const cache = (globalThis as { _mongoose?: { conn: unknown } })._mongoose;
  assert.ok(cache, "landmark: lib/db.ts keeps its connection cache on globalThis._mongoose");
  const savedConn = cache.conn;
  const savedUri = process.env.MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://in-memory-stand-in/unit";
  cache.conn = {};
  try {
    await run(db);
  } finally {
    cache.conn = savedConn;
    if (savedUri === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = savedUri;
    Object.assign(rate, { findOneAndUpdate: saved.findOneAndUpdate, updateOne: saved.updateOne, deleteMany: saved.deleteMany });
    Object.assign(staff, { findOne: saved.staffFindOne, findOneAndUpdate: saved.staffFindOneAndUpdate });
  }
}

const ME = "665f0000000000000000c0a1";
const person = (over: Partial<Row> = {}): Row => ({
  _id: ME,
  name: "Asha Rao",
  role: "staff",
  isActive: true,
  pin: "7391",
  hasPin: true,
  pinBlocked: false,
  pinFailCount: 0,
  ...over,
});

test("verifyOwnStaffPin: the right PIN takes a slot before the person is read, and hands it back", async () => {
  await withFakeDb({ row: person() }, async (db) => {
    const result = await verifyOwnStaffPin({ staffId: ME, pin: "7391" });
    assert.deepEqual(result, { ok: true }, "the right PIN answers ok (no user: nobody signs in)");
    assert.deepEqual(db.calls, ["slot", "read", "refund"], "slot first, then the read and the compare, then the refund");
    assert.equal(db.window, 0, "the window counts nothing for a right PIN");
    assert.equal(db.row?.pinFailCount, 0, "the day count is untouched");
  });
});

test("verifyOwnStaffPin: a wrong PIN keeps its slot and counts the cafe-day, with the tries left from the window", async () => {
  await withFakeDb({ window: 1, row: person({ pinFailCount: 3 }) }, async (db) => {
    const result = await verifyOwnStaffPin({ staffId: ME, pin: "0001" });
    assert.deepEqual(result, { ok: false, failure: { kind: "wrong", triesLeft: STAFF_PIN_RATE_MAX - 2 } }, "wrong, 3 tries left after the window's 2nd");
    assert.deepEqual(db.calls, ["slot", "read", "count-day"], "the slot is kept (no refund) and the day count goes up");
    assert.equal(db.window, 2, "the wrong PIN stays in the window");
    assert.equal(db.row?.pinFailCount, 4, "the day count is one higher");
  });
});

test("verifyOwnStaffPin: a full window answers wait before reading anyone, its slot handed back", async () => {
  await withFakeDb({ window: STAFF_PIN_RATE_MAX, row: person() }, async (db) => {
    const result = await verifyOwnStaffPin({ staffId: ME, pin: "7391" });
    assert.equal(result.ok, false, "even the right PIN waits");
    const failure = result.ok ? null : result.failure;
    assert.equal(failure?.kind, "wait", "the answer is wait");
    assert.ok(failure?.kind === "wait" && failure.retryAfterSec >= 1, "with a positive retry-after");
    assert.deepEqual(db.calls, ["slot", "refund"], "nobody is read: the slot goes straight back");
    assert.equal(db.window, STAFF_PIN_RATE_MAX, "the window keeps only its earlier wrongs");
  });
});

test("verifyOwnStaffPin: no PIN, an inactive person or a blocked PIN hand the slot back", async () => {
  const cases: Array<[string, Row | null, string]> = [
    ["no PIN set", person({ hasPin: false, pin: undefined }), "nopin"],
    ["a stored PIN the rules refuse", person({ pin: "1234" }), "nopin"],
    ["an inactive person", person({ isActive: false }), "nopin"],
    ["no such person", null, "nopin"],
    ["a blocked PIN", person({ pinBlocked: true }), "blocked"],
  ];
  for (const [label, row, kind] of cases) {
    await withFakeDb({ row }, async (db) => {
      const result = await verifyOwnStaffPin({ staffId: ME, pin: "7391" });
      assert.equal(result.ok ? "ok" : result.failure.kind, kind, `${label} -> ${kind}`);
      assert.deepEqual(db.calls, ["slot", "read", "refund"], `${label}: the slot is handed back`);
      assert.equal(db.window, 0, `${label}: the window counts nothing`);
    });
  }
});

test("verifyOwnStaffPin: a bad shape answers wrong without touching the database", async () => {
  delete process.env.MONGODB_URI;
  const shapes: Array<[string, unknown, unknown]> = [
    ["no session id", undefined, "7391"],
    ["an id that is not 24 hex", "not-an-id", "7391"],
    ["three digits", ME, "739"],
    ["a number for a PIN", ME, 7391],
    ["no PIN", ME, undefined],
  ];
  const prunes = await prunesDuring(async () => {
    for (const [label, staffId, pin] of shapes) {
      const result = await verifyOwnStaffPin({ staffId, pin });
      assert.deepEqual(result, { ok: false, failure: { kind: "wrong", triesLeft: 0 } }, `${label} -> wrong, no count shown`);
    }
  });
  assert.equal(prunes, 0, "a bad shape never runs the rate-window prune (it answers before connectDB)");
});

// The reveal dialog's up-front look-up (Task 6 fix 1): the session's own row, read only. It takes no slot in the window,
// compares nothing and counts nothing, so opening the dialog can never cost a try.
test("ownStaffPinState: ready, nopin or blocked from one read of the person's row; no slot, no compare, no count", async () => {
  const cases: Array<[string, Row | null, string]> = [
    ["a PIN set", person(), "ready"],
    ["no PIN set", person({ hasPin: false, pin: undefined }), "nopin"],
    ["a stored PIN the rules refuse", person({ pin: "1234" }), "nopin"],
    ["an inactive person", person({ isActive: false }), "nopin"],
    ["no such person", null, "nopin"],
    ["a blocked PIN", person({ pinBlocked: true }), "blocked"],
  ];
  for (const [label, row, want] of cases) {
    await withFakeDb({ window: STAFF_PIN_RATE_MAX, row }, async (db) => {
      assert.equal(await ownStaffPinState({ staffId: ME }), want, `${label} -> ${want}`);
      assert.deepEqual(db.calls, ["read"], `${label}: one read, no slot, no refund, no day count`);
      assert.equal(db.window, STAFF_PIN_RATE_MAX, `${label}: the window is untouched (even full, the look-up still answers)`);
    });
  }
});

test("ownStaffPinState: no valid session id answers nopin without touching the database", async () => {
  delete process.env.MONGODB_URI;
  for (const id of [undefined, "not-an-id", 42]) {
    assert.equal(await ownStaffPinState({ staffId: id }), "nopin", `${String(id)} -> nopin`);
  }
});
