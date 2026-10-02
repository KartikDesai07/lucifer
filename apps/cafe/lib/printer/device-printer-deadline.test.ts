import { test } from "node:test";
import assert from "node:assert/strict";

import { PortFake, SerialFake, flush } from "@/lib/printer/device-printer-fakes";
import { NATIVE_RECORD, SERIAL_RECORD, makeEnv, nativeFake, nativeStatus } from "@/lib/printer/device-printer-env";
import {
  DEVICE_WRITE_DEADLINE_MS,
  PRINTER_CONNECT_FAILED_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
} from "@/lib/printer/device-printer";
import { WRITE_TEARDOWN_WAIT_MS } from "@/lib/printer/device-printer-write";
import { nativeError } from "@/lib/printer/native-bridge";
import { SAVED_CONNECT_DEADLINE_MS } from "@/lib/printer/device-printer-link";

// The write deadline (measured from ENQUEUE, with a real teardown) and the
// saved-printer connect deadline, over fake ports and a manual clock.

async function connectedSerial() {
  const port = new PortFake();
  const serial = new SerialFake();
  serial.granted = [port];
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  return Object.assign(env, { port, serial });
}

const outcomeOf = (job: Promise<void>): Promise<string> => job.then(() => "resolved", (e: Error) => e.message);

test("constants: 70 s write deadline, 20 s saved-connect deadline", () => {
  assert.equal(DEVICE_WRITE_DEADLINE_MS, 70_000);
  assert.equal(SAVED_CONNECT_DEADLINE_MS, 20_000);
});

test("W-C: a write queued behind a slow job expires by ITS OWN deadline, measured from enqueue", async () => {
  const { printer, port, clock } = await connectedSerial();
  let releaseFirst: () => void = () => undefined;
  port.gates.push(new Promise<void>((resolve) => (releaseFirst = resolve)));
  const first = printer.write(new Uint8Array(10));
  await flush();
  port.hangWrites = 1; // the SECOND job's send never answers
  const second = outcomeOf(printer.write(new Uint8Array(20)));
  await clock.advance(60_000);
  releaseFirst();
  await first;
  await clock.advance(DEVICE_WRITE_DEADLINE_MS - 60_000 - 1);
  assert.equal(port.writeAttempts, 2, "the second job did start and is hanging");
  let settled = false;
  void second.then(() => (settled = true));
  await flush();
  assert.equal(settled, false, "1 ms before 70 s from enqueue");
  await clock.advance(1);
  assert.equal(await second, PRINTER_WRITE_FAILED_MESSAGE, "failed at 70 s after ENQUEUE, not 70 s after it started");
});

test("W-B: a deadline that fires during a slow reconnect never lets the resend run, and the link is closed", async () => {
  const { printer, port, clock } = await connectedSerial();
  let releaseFirst: () => void = () => undefined;
  port.gates.push(new Promise<void>((resolve) => (releaseFirst = resolve)));
  const first = printer.write(new Uint8Array(10));
  await flush();
  const second = outcomeOf(printer.write(new Uint8Array(20)));
  await clock.advance(60_000);
  port.drop(); // the link goes down while the second job waits its turn
  let finishOpen: () => void = () => undefined;
  port.open = () =>
    new Promise<void>((resolve) => {
      finishOpen = () => {
        port.opened = true;
        resolve();
      };
    });
  releaseFirst();
  await first;
  await clock.advance(DEVICE_WRITE_DEADLINE_MS - 60_000);
  assert.equal(await second, PRINTER_WRITE_FAILED_MESSAGE, "the deadline fired while the reconnect was still opening");
  finishOpen(); // the reconnect completes AFTER the deadline
  await flush();
  assert.deepEqual(port.delivered, [10], "the late reconnect never sent the second job");
  assert.equal(port.writeAttempts, 1);
  assert.equal(port.closes >= 1 && port.opened === false, true, "the link the late reconnect opened was closed");
  assert.equal(printer.getSnapshot().status, "disconnected");
});

test("W-B: a send that fails only AFTER the deadline is not retried", async () => {
  const { printer, port, clock } = await connectedSerial();
  let failSend: () => void = () => undefined;
  port.gates.push(new Promise<void>((resolve) => (failSend = resolve)));
  port.failWrites = 1;
  const job = outcomeOf(printer.write(new Uint8Array(10)));
  await flush();
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.equal(await job, PRINTER_WRITE_FAILED_MESSAGE);
  failSend();
  await flush();
  assert.equal(port.writeAttempts, 1, "no resend");
  assert.equal(port.opens, 1, "no reconnect for it either");
});

test("W-B: the deadline tears the stuck write down — the link is closed and shown as down before the queue moves on", async () => {
  const { printer, port, clock } = await connectedSerial();
  port.hangWrites = 1;
  const job = outcomeOf(printer.write(new Uint8Array(10)));
  await flush();
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.equal(await job, PRINTER_WRITE_FAILED_MESSAGE);
  assert.equal(port.closes, 1);
  assert.equal(printer.getSnapshot().status, "disconnected");
  assert.equal(clock.pending(), 1, "the reconnect backoff is armed");
});

test("W-J: a saved open that never settles ends failed at 20 s, says so, and the backoff re-arms", async () => {
  const port = new PortFake();
  let opens = 0;
  let lateOpen: () => void = () => undefined;
  port.open = () => {
    opens += 1;
    return new Promise<void>((resolve) => {
      lateOpen = () => {
        port.opened = true;
        resolve();
      };
    });
  };
  const serial = new SerialFake();
  serial.granted = [port];
  const env = makeEnv({ stored: SERIAL_RECORD, serial });
  env.printer.init();
  await flush();
  assert.equal(env.printer.getSnapshot().status, "connecting");
  await env.clock.advance(SAVED_CONNECT_DEADLINE_MS - 1);
  assert.equal(env.printer.getSnapshot().status, "connecting");
  await env.clock.advance(1);
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  assert.equal(env.printer.getSnapshot().message, PRINTER_CONNECT_FAILED_MESSAGE);
  assert.equal(env.clock.pending(), 1, "the 2 s backoff is armed");
  lateOpen(); // the abandoned open finally answers: its link is closed, never adopted
  await flush();
  assert.equal(port.closes, 1);
  assert.equal(env.printer.getSnapshot().status, "disconnected");
  await env.clock.advance(2_000);
  assert.equal(opens, 2, "the backoff retried the open");
  port.open = PortFake.prototype.open.bind(port);
  await env.clock.advance(SAVED_CONNECT_DEADLINE_MS + 5_000);
  assert.equal(env.printer.getSnapshot().status, "connected");
});

test("W-B: the next job waits for the teardown, but a close that never answers cannot freeze the queue", async () => {
  const { printer, port, clock } = await connectedSerial();
  port.hangWrites = 1;
  port.close = () => new Promise<void>(() => undefined);
  const stuck = outcomeOf(printer.write(new Uint8Array(10)));
  await flush();
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.equal(await stuck, PRINTER_WRITE_FAILED_MESSAGE);
  const next = printer.write(new Uint8Array(20));
  await clock.advance(WRITE_TEARDOWN_WAIT_MS - 1);
  assert.equal(port.writeAttempts, 1, "still waiting for the teardown");
  await clock.advance(1);
  await next;
  assert.deepEqual(port.delivered, [20]);
});

// ---- the app lane: the app owns the link, so only the expired flag keeps a late reconnect from printing ----

async function nativeLane(status: unknown) {
  const native = nativeFake();
  native.respond("printer.status", () => status);
  const env = makeEnv({ stored: NATIVE_RECORD, native });
  env.printer.init();
  await flush();
  return Object.assign(env, { fake: native });
}

test("W-B (app lane): a deadline that fires during the first reconnect never prints afterwards", async () => {
  const { printer, fake, clock } = await nativeLane(nativeStatus("disconnected"));
  let finishReconnect: () => void = () => undefined;
  fake.respond("printer.reconnect", () => new Promise((resolve) => (finishReconnect = () => resolve(nativeStatus("connected")))));
  fake.respond("printer.print", () => ({ bytes: 4 }));
  const job = outcomeOf(printer.write(new Uint8Array(4)));
  await flush();
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.equal(await job, PRINTER_WRITE_FAILED_MESSAGE);
  finishReconnect();
  await flush();
  assert.equal(fake.count("printer.print"), 0);
});

test("W-B (app lane): a deadline that fires during the reconnect after a failed print never resends", async () => {
  const { printer, fake, clock } = await nativeLane(nativeStatus("connected"));
  let finishReconnect: () => void = () => undefined;
  fake.respond("printer.print", () => {
    throw nativeError("WRITE_FAILED", "x");
  });
  fake.respond("printer.reconnect", () => new Promise((resolve) => (finishReconnect = () => resolve(nativeStatus("connected")))));
  const job = outcomeOf(printer.write(new Uint8Array(4)));
  await flush();
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.equal(await job, PRINTER_WRITE_FAILED_MESSAGE);
  finishReconnect();
  await flush();
  assert.equal(fake.count("printer.print"), 1, "the ONE resend never ran");
});

test("W-C: a job whose deadline passed while it waited its turn is never sent", async () => {
  const { printer, port, clock } = await connectedSerial();
  port.hangWrites = 1;
  port.close = () => new Promise<void>(() => undefined); // the teardown holds the queue for its full wait
  const stuck = outcomeOf(printer.write(new Uint8Array(10)));
  await flush();
  await clock.advance(1);
  const waiting = outcomeOf(printer.write(new Uint8Array(20))); // its own deadline: 1 ms after the first one's
  await clock.advance(DEVICE_WRITE_DEADLINE_MS);
  assert.deepEqual([await stuck, await waiting], [PRINTER_WRITE_FAILED_MESSAGE, PRINTER_WRITE_FAILED_MESSAGE]);
  await clock.advance(WRITE_TEARDOWN_WAIT_MS);
  assert.equal(port.writeAttempts, 1, "only the stuck first send ever happened");
  assert.deepEqual(port.delivered, []);
});
