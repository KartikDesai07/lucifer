import assert from "node:assert/strict";
import { test } from "node:test";
import { PublicRateLimit } from "@/models/PublicRateLimit";
import type { PinDevicePerson } from "./pin-device";
import { nextPinFailState, verifyStaffPinSignIn } from "./staff-pin-signin";

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
