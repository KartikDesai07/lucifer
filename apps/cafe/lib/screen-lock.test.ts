import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NOW_SERVING_PATH } from "@/components/now-serving/NowServingLink";
import { DASHBOARD_KEYS } from "@/hooks/use-dashboard";
import { EXPENSE_KEYS } from "@/hooks/use-expenses";
import { PRINT_DEVICES_KEYS } from "@/hooks/use-print-setup";
import { REPORT_KEYS } from "@/hooks/use-reports";
import { STAFF_KEYS } from "@/hooks/use-staff";
import { TELEGRAM_KEYS } from "@/hooks/use-telegram";

import {
  LOCK_ATTR,
  LOCK_READY_ATTR,
  PERSON_SCOPED_QUERY_ROOTS,
  SCREEN_LOCK_EVENT,
  SCREEN_LOCK_SCRIPT,
  SCREEN_LOCK_STORAGE_KEY,
  autoLockDue,
  clearLockState,
  isDisplayPath,
  isPersonScopedQuery,
  lockedAgoLabel,
  readLockState,
  requestScreenLock,
  screenLockLine,
  writeLockState,
  type LockState,
} from "./screen-lock";

function fakeStorage(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(SCREEN_LOCK_STORAGE_KEY, initial);
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const MIN = 60_000;

describe("lock state storage", () => {
  const state: LockState = { locked: true, by: "u1", byName: "Asha", at: 1000 };

  it("round trips and clears", () => {
    const s = fakeStorage();
    assert.equal(readLockState(s), null, "empty storage reads null");
    writeLockState(s, state);
    assert.deepEqual(readLockState(s), state, "round trip");
    clearLockState(s);
    assert.equal(readLockState(s), null, "cleared reads null");
  });

  it("accepts null by/byName", () => {
    const s = fakeStorage();
    const n: LockState = { locked: true, by: null, byName: null, at: 5 };
    writeLockState(s, n);
    assert.deepEqual(readLockState(s), n, "null person round trips");
  });

  it("rejects bad shapes", () => {
    assert.equal(readLockState(fakeStorage("{nope")), null, "bad JSON");
    assert.equal(readLockState(fakeStorage('{"locked":false,"at":1,"by":null,"byName":null}')), null, "locked false");
    assert.equal(readLockState(fakeStorage('{"locked":true,"at":"x","by":null,"byName":null}')), null, "at not number");
    assert.equal(readLockState(fakeStorage('{"locked":true,"at":1,"by":5,"byName":null}')), null, "by not string");
    assert.equal(readLockState(fakeStorage('{"locked":true,"at":1,"by":null,"byName":7}')), null, "byName not string");
    assert.equal(readLockState(fakeStorage("null")), null, "null JSON");
    assert.equal(readLockState(fakeStorage("[]")), null, "array JSON");
    assert.equal(readLockState(null), null, "null storage");
  });

  it("a throwing storage reads null and writes do not throw", () => {
    const bad = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    assert.equal(readLockState(bad), null, "throwing read");
    assert.doesNotThrow(() => writeLockState(bad, state), "throwing write");
    assert.doesNotThrow(() => clearLockState(bad), "throwing clear");
  });
});

describe("autoLockDue and display paths", () => {
  it("fires at the minute boundary, wall-clock", () => {
    const base = { lastActivityAt: 0, minutes: 60, pathname: "/pos" };
    assert.equal(autoLockDue({ ...base, now: 60 * MIN - 1000 }), false, "59:59");
    assert.equal(autoLockDue({ ...base, now: 60 * MIN }), true, "60:00");
    assert.equal(autoLockDue({ ...base, now: 5 * 60 * MIN }), true, "hours later");
  });

  it("never when off or on a display page", () => {
    const late = { lastActivityAt: 0, now: 10 * 60 * MIN };
    assert.equal(autoLockDue({ ...late, minutes: 0, pathname: "/pos" }), false, "minutes 0");
    assert.equal(autoLockDue({ ...late, minutes: -1, pathname: "/pos" }), false, "minutes negative");
    assert.equal(autoLockDue({ ...late, minutes: 30, pathname: "/kitchen" }), false, "/kitchen");
    assert.equal(autoLockDue({ ...late, minutes: 30, pathname: "/kitchen/x" }), false, "/kitchen/x");
    assert.equal(autoLockDue({ ...late, minutes: 30, pathname: NOW_SERVING_PATH }), false, "now serving");
    assert.equal(autoLockDue({ ...late, minutes: 30, pathname: "/pos" }), true, "/pos");
  });

  it("isDisplayPath is exact or sub-path only", () => {
    assert.equal(isDisplayPath("/kitchen"), true, "kitchen");
    assert.equal(isDisplayPath("/kitchen/a"), true, "kitchen sub");
    assert.equal(isDisplayPath(NOW_SERVING_PATH), true, "now serving");
    assert.equal(isDisplayPath("/kitchenette"), false, "prefix lookalike");
    assert.equal(isDisplayPath("/pos"), false, "pos");
  });
});

describe("labels", () => {
  it("lockedAgoLabel", () => {
    assert.equal(lockedAgoLabel(0, 59_000), "Locked · just now", "under a minute");
    assert.equal(lockedAgoLabel(0, MIN), "Locked · 1 min ago", "one minute");
    assert.equal(lockedAgoLabel(0, 59 * MIN), "Locked · 59 min ago", "59 min");
    assert.equal(lockedAgoLabel(0, 60 * MIN), "Locked · 1 h ago", "1 h");
    assert.equal(lockedAgoLabel(0, 150 * MIN), "Locked · 2 h ago", "floor hours");
  });

  // U0 Task 4: the profile sheet's footer takes the owner's HTML words (values 2.7) with our setting in minutes.
  it("screenLockLine", () => {
    assert.equal(screenLockLine(0), "Auto-lock is off", "off");
    assert.equal(screenLockLine(30), "Auto-locks after 30 min without activity", "30");
    assert.equal(screenLockLine(60), "Auto-locks after 60 min without activity", "60");
    assert.equal(screenLockLine(120), "Auto-locks after 120 min without activity", "120");
  });
});

describe("no-flash script", () => {
  function run(stored: string | null) {
    const calls: Array<[string, string]> = [];
    const storage = { getItem: (k: string) => (k === SCREEN_LOCK_STORAGE_KEY ? stored : null) };
    const doc = { documentElement: { setAttribute: (a: string, v: string) => void calls.push([a, v]) } };
    new Function("localStorage", "document", SCREEN_LOCK_SCRIPT)(storage, doc);
    return calls;
  }

  it("sets the attribute only for a locked state", () => {
    assert.deepEqual(run('{"locked":true}'), [[LOCK_ATTR, ""]], "locked");
    assert.deepEqual(run('{"locked":false}'), [], "unlocked");
    assert.deepEqual(run(null), [], "missing");
    assert.deepEqual(run("garbage{"), [], "garbage");
    assert.deepEqual(run("null"), [], "null json");
  });

  it("does not throw when storage throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    assert.doesNotThrow(() => new Function("localStorage", "document", SCREEN_LOCK_SCRIPT)(storage, {}), "throwing");
  });

  it("is safe as a React script child", () => {
    assert.ok(!/[<>&]/.test(SCREEN_LOCK_SCRIPT), "no <, > or & in the script");
    assert.equal(LOCK_ATTR, "data-pos-locked", "attr name");
    assert.equal(LOCK_READY_ATTR, "data-pos-lock-ready", "ready attr name");
  });
});

describe("person-scoped queries", () => {
  it("roots match the hook modules", () => {
    assert.deepEqual(
      [...PERSON_SCOPED_QUERY_ROOTS],
      [
        STAFF_KEYS.all[0],
        REPORT_KEYS.all[0],
        DASHBOARD_KEYS.all[0],
        EXPENSE_KEYS.all[0],
        TELEGRAM_KEYS.status[0],
        PRINT_DEVICES_KEYS.all[0],
      ],
      "roots follow the hook keys",
    );
  });

  it("isPersonScopedQuery", () => {
    assert.equal(isPersonScopedQuery(["reports", "sales", "a", "b"]), true, "reports");
    assert.equal(isPersonScopedQuery(["print-devices"]), true, "print devices");
    assert.equal(isPersonScopedQuery(["orders"]), false, "orders");
    assert.equal(isPersonScopedQuery([]), false, "empty");
    assert.equal(isPersonScopedQuery([1]), false, "non-string root");
  });
});

describe("requestScreenLock", () => {
  it("does not throw without a window", () => {
    assert.doesNotThrow(() => requestScreenLock("manual"), "no window");
  });

  it("dispatches the event with the reason", () => {
    const g = globalThis as unknown as { window?: unknown };
    const got: Array<{ type: string; detail: unknown }> = [];
    g.window = { dispatchEvent: (e: { type: string; detail: unknown }) => void got.push({ type: e.type, detail: e.detail }) };
    try {
      requestScreenLock("switch");
    } finally {
      delete g.window;
    }
    assert.deepEqual(got, [{ type: SCREEN_LOCK_EVENT, detail: { reason: "switch" } }], "event dispatched");
  });
});
