import { test } from "node:test";
import assert from "node:assert/strict";

import { BleFake, PortFake, SerialFake, bluetoothOf, flush } from "@/lib/printer/device-printer-fakes";
import { BLE_RECORD, SERIAL_RECORD, makeEnv } from "@/lib/printer/device-printer-env";
import { DEVICE_WRITE_DEADLINE_MS, PRINTER_CONNECT_FAILED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/device-printer";
import { WRITE_TEARDOWN_WAIT_MS } from "@/lib/printer/device-printer-write";
import { SAVED_CONNECT_DEADLINE_MS } from "@/lib/printer/device-printer-link";

// Round 2: a deadline's teardown must really free the port (Web Serial refuses
// close() while a writer holds the stream), a hanging saved BLE connect is
// disconnected at its deadline, and no slip starts while a teardown still runs.

async function connectedSerial(configure: (port: PortFake) => void = () => undefined) {
  const port = new PortFake();
  configure(port);
  const serial = new SerialFake();
  serial.granted = [port];
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  return Object.assign(env, { port, serial });
}

const outcomeOf = (job: Promise<void>): Promise<string> => job.then(() => "resolved", (e: Error) => e.message);

test("R2-W1: the deadline's teardown aborts the hung writer, so the port really closes and the retry reopens it", async () => {
  const { printer, port, clock } = await connectedSerial((p) => (p.strictOpen = true));
  port.hangWrites = 1;
  const job = outcomeOf(printer.write(new Uint8Array(10)));
  await flush();
  assert.notEqual(port.held, null, "the stuck write holds the stream's lock");
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.equal(await job, PRINTER_WRITE_FAILED_MESSAGE);
  assert.equal(port.opened, false, "the port is closed, not left open");
  assert.equal(port.closes, 1);
  assert.equal(port.aborts, 1, "the writer was aborted");
  assert.equal(port.held, null, "the lock was given back");
  assert.equal(printer.getSnapshot().status, "disconnected");
  await clock.advance(2_000); // the 2 s backoff reopens the same port
  await clock.advance(1);
  assert.equal(printer.getSnapshot().status, "connected", "the reopen was not refused as already open");
  assert.equal(printer.getSnapshot().message, null);
  await printer.write(new Uint8Array(20));
  assert.deepEqual(port.delivered, [20]);
});

test("R2-W3: a saved BLE connect that hangs is disconnected at the deadline, even on the first open after a reload", async () => {
  const ble = new BleFake();
  ble.hangConnect = 1;
  const env = makeEnv({ stored: BLE_RECORD, bluetooth: bluetoothOf(ble, true) });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connecting");
  await env.clock.advance(SAVED_CONNECT_DEADLINE_MS - 1);
  assert.equal(ble.disconnects, 0, "not before the deadline");
  assert.equal(env.printer.getSnapshot().status, "connecting");
  await env.clock.advance(1);
  assert.equal(ble.disconnects, 1, "the pending connect was aborted by gatt.disconnect()");
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  assert.equal(env.printer.getSnapshot().message, PRINTER_CONNECT_FAILED_MESSAGE);
  assert.equal(env.clock.pending(), 1, "the backoff is armed");
  await env.clock.advance(2_000); // the retry connects for real
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connected");
});

test("R2-W4: a slip queued behind an expired-before-start slip still waits for the first slip's teardown", async () => {
  const { printer, port, clock } = await connectedSerial();
  port.hangWrites = 1;
  port.close = () => new Promise<void>(() => undefined); // job A's teardown runs for its full bounded wait
  const a = outcomeOf(printer.write(new Uint8Array(10)));
  await flush();
  await clock.advance(1);
  const b = outcomeOf(printer.write(new Uint8Array(20))); // expires 1 ms after A, never having started
  await clock.advance(19_999);
  const c = printer.write(new Uint8Array(30)); // its own deadline is still far away
  await clock.advance(DEVICE_WRITE_DEADLINE_MS - 20_000 + 1); // A's deadline passed, B's is due now
  assert.deepEqual([await a, await b], [PRINTER_WRITE_FAILED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE]);
  assert.equal(port.opens, 1, "C has not started (no reconnect, no send) while A's teardown runs");
  assert.equal(port.writeAttempts, 1);
  await clock.advance(WRITE_TEARDOWN_WAIT_MS);
  await c;
  assert.deepEqual(port.delivered, [30], "C printed once the teardown wait ended");
});
