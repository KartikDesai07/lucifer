// PX-3 final review (I2, m3): the guided connect's Bluetooth scan decisions, pure. What a finished scan shows (a scan that
// did nothing changes nothing), the Allow tap (refused → the steps, granted → a scan, one at a time) and when the list
// scans by itself (once when it first answers; once more when Bluetooth turns usable).
import { test } from "node:test";
import assert from "node:assert/strict";

import { autoScanOf, bluetoothScanOf, scanShownOf, type ScanShown } from "@/lib/printer/bluetooth-scan";
import { nativeError } from "@/lib/printer/native-bridge";
import { nativeErrorMessage } from "@/lib/printer/transport-native";

const REFUSED = nativeError("UNAUTHORIZED", "scan refused");
const OFF = nativeError("BLUETOOTH_OFF", "raw");
const NONE: ScanShown = { error: null, refusal: null };

function harness(answers: unknown[]) {
  const shown: ScanShown[] = [];
  let scans = 0;
  const scan = (): Promise<unknown> => {
    scans += 1;
    return Promise.resolve(answers.shift() ?? null);
  };
  return { shown, scan, scans: () => scans, scanner: bluetoothScanOf((next) => shown.push(next)) };
}

test("a finished scan: listed clears, a Location refusal asks to Allow, any other error says its words", () => {
  assert.deepEqual(scanShownOf(null, false), NONE, "listed: nothing to say");
  assert.deepEqual(scanShownOf(REFUSED, false), { error: null, refusal: "allow" }, "refused for Location: Allow");
  assert.deepEqual(scanShownOf(REFUSED, true), { error: null, refusal: "settings-steps" }, "refused after a refused Allow: the steps");
  assert.deepEqual(scanShownOf(OFF, false), { error: nativeErrorMessage(OFF), refusal: null }, "another error: the app's own sentence inline");
  assert.equal(scanShownOf(undefined, false), undefined, "a scan that did nothing: no change at all");
});

test("search shows what the scan answered; a scan that did nothing changes nothing", async () => {
  const h = harness([REFUSED]);
  await h.scanner.search(h.scan);
  assert.deepEqual(h.shown, [{ error: null, refusal: "allow" }], "refused → Allow");
  const idle = harness([]);
  await idle.scanner.search(() => Promise.resolve(undefined));
  assert.deepEqual(idle.shown, [], "a tap while the list is held never clears the running scan's outcome");
});

test("Allow refused → the steps, and the next refusal shows them too", async () => {
  const h = harness([REFUSED]);
  await h.scanner.allowLocation(h.scan, () => Promise.resolve({ granted: false }));
  assert.deepEqual(h.shown, [{ error: null, refusal: "settings-steps" }], "Android said no: the Settings steps");
  assert.equal(h.scans(), 0, "no scan after a refused Allow");
  await h.scanner.search(h.scan);
  assert.deepEqual(h.shown[h.shown.length - 1], { error: null, refusal: "settings-steps" }, "Android will not ask twice: a later refusal shows the steps");
});

test("Allow granted → one scan, its outcome shown", async () => {
  const h = harness([null]);
  await h.scanner.allowLocation(h.scan, () => Promise.resolve({ granted: true }));
  assert.equal(h.scans(), 1, "granted: the list scans");
  assert.deepEqual(h.shown, [NONE], "it listed: the notice goes");
  const failed = harness([]);
  await failed.scanner.allowLocation(failed.scan, () => Promise.reject(OFF));
  assert.deepEqual(failed.shown, [{ error: nativeErrorMessage(OFF), refusal: null }], "the ask failed: the app's own sentence");
});

test("a second Allow while one runs does nothing", async () => {
  const h = harness([null, null]);
  let asks = 0;
  let answer: (value: { granted: boolean }) => void = () => undefined;
  const ask = (): Promise<{ granted: boolean }> => {
    asks += 1;
    return new Promise((resolve) => {
      answer = resolve;
    });
  };
  const first = h.scanner.allowLocation(h.scan, ask);
  await h.scanner.allowLocation(h.scan, ask);
  assert.equal(asks, 1, "a double tap asks Android once");
  answer({ granted: true });
  await first;
  assert.equal(h.scans(), 1, "and scans once");
  await h.scanner.allowLocation(h.scan, () => Promise.resolve({ granted: true }));
  assert.equal(h.scans(), 2, "once it ended, Allow works again");
});

test("the automatic scan: once when the list first answers; once more when Bluetooth turns usable", () => {
  for (const state of ["on", null] as const) assert.equal(autoScanOf(undefined, state), true, `first answer, Bluetooth ${state}: it scans by itself`);
  for (const state of ["off", "unauthorized", "unsupported"] as const) assert.equal(autoScanOf(undefined, state), false, `first answer, Bluetooth ${state}: its notice says why`);
  assert.equal(autoScanOf("off", "on"), true, "Turn on Bluetooth: it scans again");
  assert.equal(autoScanOf("unauthorized", "on"), true, "Allow Bluetooth: it scans again");
  assert.equal(autoScanOf("unauthorized", "off"), false, "allowed but off: still nothing to scan with");
  assert.equal(autoScanOf("on", "off"), false, "turned off: no scan");
  assert.equal(autoScanOf(null, "on"), false, "the status came after the first scan: no second one");
  assert.equal(autoScanOf("on", "on"), false, "nothing changed");
});
