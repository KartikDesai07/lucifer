import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { desktopLan, setDesktopLanInstance, type DesktopLan } from "@/lib/printer/desktop-lan";
import {
  armLaneWrite,
  laneKeyOfTarget,
  laneWrite,
  lanLaneKey,
  nativeLaneKey,
  withLaneWrites,
} from "@/lib/printer/lane-writes";
import { setNativePoolInstance, type NativePool } from "@/lib/printer/native-pool";
import { printerWriter } from "@/lib/printer/printer-registry";

// Phase 6 Task 2 (spec §9 ruling 9): the one-shot hand-off by printer lane key.

const KEY = "native:tcp:127.0.0.1:9101";
const never = (): Promise<void> => {
  throw new Error("must not run");
};

let disarms: Array<() => void> = [];
const arm = (key: string, take: (write: () => Promise<void>) => void): (() => void) => {
  const disarm = armLaneWrite(key, take);
  disarms.push(disarm);
  return disarm;
};

afterEach(() => {
  for (const d of disarms) d();
  disarms = [];
  setNativePoolInstance(null);
  setDesktopLanInstance(null);
});

describe("lane writes", () => {
  it("an unarmed write is written as today", async () => {
    let calls = 0;
    await laneWrite(KEY, async () => {
      calls += 1;
    });
    assert.equal(calls, 1, "the write ran once");
    await assert.rejects(
      laneWrite(KEY, () => Promise.reject(new Error("boom"))),
      /boom/,
      "a rejection passes through",
    );
  });

  it("an armed write of its key is handed off and answers at once", async () => {
    let taken: (() => Promise<void>) | null = null;
    let ran = 0;
    arm(KEY, (w) => {
      taken = w;
    });
    await laneWrite(KEY, async () => {
      ran += 1;
    });
    assert.equal(ran, 0, "the write has not run when laneWrite answered");
    assert.equal(typeof taken, "function", "take got a function");
    await (taken as unknown as () => Promise<void>)();
    assert.equal(ran, 1, "calling the taken function runs the write");
  });

  it("a write of another key, or the second write of the armed key, is written as today", async () => {
    let takes = 0;
    arm(KEY, () => {
      takes += 1;
    });
    let other = 0;
    await laneWrite("native:other", async () => {
      other += 1;
    });
    assert.equal(other, 1, "another key is written at once");
    assert.equal(takes, 0, "another key does not take the arm");
    await laneWrite(KEY, never);
    assert.equal(takes, 1, "the armed key is taken once");
    let second = 0;
    await laneWrite(KEY, async () => {
      second += 1;
    });
    assert.equal(second, 1, "the second write of the armed key is written as today");
    assert.equal(takes, 1, "the arm was one-shot");
  });

  it("disarm clears its own arm only, and twice is harmless", async () => {
    const disarmA = arm(KEY, () => assert.fail("A must not take"));
    let bTakes = 0;
    arm(KEY, () => {
      bTakes += 1;
    });
    disarmA();
    disarmA();
    await laneWrite(KEY, async () => undefined);
    assert.equal(bTakes, 1, "the later arm survived the earlier one's disarm");
    let cTakes = 0;
    const disarmC = arm(KEY, () => {
      cTakes += 1;
    });
    disarmC();
    disarmC();
    let ran = 0;
    await laneWrite(KEY, async () => {
      ran += 1;
    });
    assert.equal(cTakes, 0, "a disarmed arm takes nothing");
    assert.equal(ran, 1, "the write ran as today");
  });

  it("arming again replaces the earlier arm", async () => {
    let first = 0;
    let second = 0;
    arm(KEY, () => {
      first += 1;
    });
    arm(KEY, () => {
      second += 1;
    });
    await laneWrite(KEY, async () => undefined);
    assert.equal(first, 0, "the replaced arm takes nothing");
    assert.equal(second, 1, "the new arm takes the write");
  });

  it("the lan key lower-cases the host", () => {
    assert.equal(lanLaneKey({ host: "Printer.LAN", port: 9100 }), "lan:printer.lan:9100", "lan key");
    assert.equal(nativeLaneKey("tcp:Abc:1"), "native:tcp:Abc:1", "native key keeps case");
    const lan = { host: "h", port: 1 };
    assert.equal(laneKeyOfTarget({ paper: "80mm", nativeId: "x", lan }), "native:x", "native first");
    assert.equal(laneKeyOfTarget({ paper: "80mm", lan }), "lan:h:1", "lan next");
    assert.equal(laneKeyOfTarget({ paper: "80mm" }), null, "neither: null");
    assert.equal(laneKeyOfTarget(undefined), null, "no target: null");
  });

  it("printerWriter and the desktop store go through the hand-off", async () => {
    const calls: string[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const seen: Uint8Array[] = [];
    setNativePoolInstance({
      write: async (id: string, b: Uint8Array) => {
        calls.push(`native:${id}`);
        seen.push(b);
      },
    } as unknown as NativePool);
    const fakeLan = {
      write: async (t: { host: string; port: number }, b: Uint8Array) => {
        calls.push(`lan:${t.host}:${t.port}`);
        seen.push(b);
      },
    } as unknown as DesktopLan;
    setDesktopLanInstance(withLaneWrites(fakeLan));

    const taken: Array<() => Promise<void>> = [];
    arm("native:p1", (w) => taken.push(w));
    await printerWriter("p1")(bytes);
    assert.deepEqual(calls, [], "the native write has not run");
    arm("lan:h:9100", (w) => taken.push(w));
    await desktopLan().write({ host: "H", port: 9100 }, bytes);
    assert.deepEqual(calls, [], "the lan write has not run");
    assert.equal(taken.length, 2, "both writes handed off");
    for (const w of taken) await w();
    assert.deepEqual(calls, ["native:p1", "lan:H:9100"], "each ran exactly once");
    assert.ok(seen.every((b) => b === bytes), "with the same bytes");

    calls.length = 0;
    await printerWriter("p1")(bytes);
    await desktopLan().write({ host: "H", port: 9100 }, bytes);
    assert.deepEqual(calls, ["native:p1", "lan:H:9100"], "unarmed, the fakes are called at once");
  });

  it("desktopLan() wraps the store it creates in withLaneWrites", () => {
    const text = readFileSync(new URL("./desktop-lan.ts", import.meta.url), "utf8");
    assert.ok(text.includes("instance = withLaneWrites(createDesktopLan({"), "source pin: the store is wrapped");
    assert.ok(text.split("\n").length <= 301, "desktop-lan.ts stays within 300 lines");
  });
});
