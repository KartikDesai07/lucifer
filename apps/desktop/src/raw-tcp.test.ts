// Phase 3 Session 3E (spec §9.6, §13): the Windows app's raw TCP writer against a fake network printer on the
// loopback (a node:net server that answers DLE EOT like an Epson printer, or not at all, and can cut a job off). Every
// wait is shortened (RawTcpWaits); nothing here touches a real printer or the network beyond 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  BAD_ADDRESS_MESSAGE,
  NOT_CONNECTED_MESSAGE,
  RAW_TCP_WAITS,
  RawTcpError,
  healthCannotPrint,
  healthOfAnswers,
  isPrivateAddress,
  printRawTcp,
  probeRawTcp,
  resetRawTcpMemory,
  validTarget,
  type RawTcpWaits,
} from "./raw-tcp";

const FAST: RawTcpWaits = { connectMs: 1_500, refusedRetryMs: 300, afterJobMinMs: 600, afterJobMaxMs: 1_200, replyMs: 250, followUpMs: 100, drainMs: 100, jobMs: 5_000 };
const ONLINE = 0x12;
const OFFLINE = 0x1a;
const SLIP = Uint8Array.from({ length: 3_000 }, (_, i) => 0x20 + (i % 90));

interface Fake {
  port: number;
  /** The bytes each connection received, in order. */
  connections: number[][];
  /** Connections open at once, at most. */
  maxOpen: number;
  close(): Promise<void>;
}

/** A fake ESC/POS printer: `status` answers DLE EOT n (absent n: no answer; null: answers nothing at all), `dropAfter`
 *  resets a connection once it has received that many bytes. */
async function fakePrinter(status: Partial<Record<1 | 2 | 3 | 4, number>> | null, dropAfter?: number): Promise<Fake> {
  const fake: Fake = { port: 0, connections: [], maxOpen: 0, close: async () => undefined };
  let open = 0;
  const server = net.createServer((socket) => {
    const got: number[] = [];
    fake.connections.push(got);
    open += 1;
    fake.maxOpen = Math.max(fake.maxOpen, open);
    socket.on("close", () => {
      open -= 1;
    });
    socket.on("error", () => undefined);
    socket.on("data", (chunk: Buffer) => {
      for (const b of chunk) {
        got.push(b);
        const n = got.length;
        if (n >= 3 && got[n - 3] === 0x10 && got[n - 2] === 0x04 && status !== null) {
          const answer = status[b as 1 | 2 | 3 | 4];
          if (answer !== undefined) socket.write(Uint8Array.of(answer));
        }
        if (dropAfter !== undefined && got.length >= dropAfter) {
          socket.destroy();
          return;
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.port = (server.address() as net.AddressInfo).port;
  fake.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return fake;
}

/** A loopback port nobody listens on (a printer that is off and says so at once). */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const printer = (port: number) => ({ host: "127.0.0.1", port });

async function rejection(promise: Promise<unknown>): Promise<RawTcpError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof RawTcpError, `a RawTcpError, got ${String(error)}`);
    return error;
  }
  assert.fail("the job should have failed");
}

test("DLE EOT: the POS app's reading of the status bytes, bit for bit", () => {
  assert.equal(healthOfAnswers(new Map()), null, "no answer says nothing");
  assert.deepEqual(healthOfAnswers(new Map([[1, ONLINE], [2, ONLINE], [3, ONLINE], [4, ONLINE]])), { paper: "ok", cover: "closed" }, "all clear");
  assert.deepEqual(healthOfAnswers(new Map([[1, OFFLINE], [2, ONLINE | 0x20], [3, ONLINE], [4, ONLINE | 0x60]])), { paper: "out", cover: "closed" }, "paper out is not an error");
  assert.deepEqual(healthOfAnswers(new Map([[1, OFFLINE], [2, ONLINE | 0x04], [3, ONLINE], [4, ONLINE]])), { paper: "ok", cover: "open" }, "the cover open");
  assert.deepEqual(healthOfAnswers(new Map([[1, ONLINE], [2, ONLINE], [3, ONLINE], [4, ONLINE | 0x0c]])), { paper: "low", cover: "closed" }, "paper low still prints");
  assert.deepEqual(healthOfAnswers(new Map([[1, OFFLINE], [2, ONLINE], [3, ONLINE | 0x20], [4, ONLINE]])), { paper: "ok", cover: "closed", error: true }, "an error it names");
  assert.deepEqual(healthOfAnswers(new Map([[1, OFFLINE], [2, ONLINE | 0x08], [3, ONLINE], [4, ONLINE]])), { paper: "ok", cover: "closed" }, "FEED held down is not an error (the 3C review gate, m-2)");
  assert.deepEqual(healthOfAnswers(new Map([[1, OFFLINE]])), { error: true }, "offline with no cause");
  assert.equal(healthCannotPrint({ paper: "out" }), true, "out of paper cannot print");
  assert.equal(healthCannotPrint({ cover: "open" }), true, "the cover open cannot print");
  assert.equal(healthCannotPrint({ paper: "low", cover: "closed" }), false, "low paper prints");
  assert.equal(healthCannotPrint(null), false, "a silent printer prints");
});

test("only a printer on the local network is ever connected to", () => {
  for (const address of ["10.1.2.3", "172.16.0.9", "172.31.255.1", "192.168.1.60", "169.254.10.2", "127.0.0.1", "::1", "fd12:3456::1", "fe80::1", "::ffff:192.168.1.5"]) {
    assert.equal(isPrivateAddress(address), true, `${address} is local`);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "192.169.0.1", "1.1.1.1", "2001:db8::1", "::ffff:8.8.8.8", "not-an-ip"]) {
    assert.equal(isPrivateAddress(address), false, `${address} is not local`);
  }
  assert.equal(validTarget({ host: "192.168.1.60", port: 9100 }), true, "an address and port");
  assert.equal(validTarget({ host: "kitchen-printer.lan", port: 9100 }), true, "a short name");
  for (const target of [null, {}, { host: "", port: 9100 }, { host: "a b", port: 9100 }, { host: "x".repeat(254), port: 9100 }, { host: "10.0.0.1", port: 0 }, { host: "10.0.0.1", port: 65_536 }, { host: "10.0.0.1", port: 91.5 }, { host: "10.0.0.1", port: "9100" }]) {
    assert.equal(validTarget(target), false, `refused: ${JSON.stringify(target)}`);
  }
});

test("a slip goes out whole, then the printer's own answer on the same connection, then the link closes", async () => {
  resetRawTcpMemory();
  const fake = await fakePrinter({ 1: ONLINE, 2: ONLINE, 3: ONLINE, 4: ONLINE });
  try {
    const result = await printRawTcp(printer(fake.port), SLIP, FAST);
    assert.deepEqual(result.health, { paper: "ok", cover: "closed" }, "what the printer said of itself");
    assert.equal(fake.connections.length, 1, "one connection per job");
    const got = fake.connections[0] ?? [];
    assert.deepEqual(got.slice(0, SLIP.length), [...SLIP], "every byte of the slip, unchanged, first");
    assert.deepEqual(got.slice(SLIP.length), [0x10, 0x04, 1, 0x10, 0x04, 2, 0x10, 0x04, 3, 0x10, 0x04, 4], "then DLE EOT 1 to 4");
  } finally {
    await fake.close();
  }
});

test("a printer that refuses the connect: nothing sent, asked once more a moment later, and a slip it then takes prints", async () => {
  resetRawTcpMemory();
  const port = await closedPort();
  const started = Date.now();
  const error = await rejection(printRawTcp(printer(port), SLIP, FAST));
  assert.equal(error.sent, "no", "nothing reached the printer");
  assert.equal(error.failure, "not-connected", "the page acks it unreachable");
  assert.equal(error.message, NOT_CONNECTED_MESSAGE, "its words");
  assert.ok(Date.now() - started >= FAST.refusedRetryMs, "the refused connect was asked once more");

  // It refuses the first connect (another device's check holds it), then listens: the retry prints the slip.
  const server = net.createServer((socket) => {
    socket.on("error", () => undefined);
    socket.resume();
  });
  setTimeout(() => server.listen(port, "127.0.0.1"), 100);
  try {
    const result = await printRawTcp(printer(port), SLIP, FAST);
    assert.equal(result.health, null, "a printer that answers no status prints as before");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a public address is never connected to (nothing sent)", async () => {
  resetRawTcpMemory();
  const error = await rejection(printRawTcp({ host: "8.8.8.8", port: 9100 }, SLIP, FAST));
  assert.equal(error.sent, "no", "nothing sent");
  assert.equal(error.failure, "bad-address", "not on the local network");
  assert.equal(error.message, BAD_ADDRESS_MESSAGE, "its words");
});

test("G5: a printer that answered before and cuts a slip off mid-way is 'maybe'; one that never answers prints as before", async () => {
  resetRawTcpMemory();
  const talks = await fakePrinter({ 1: ONLINE, 2: ONLINE, 3: ONLINE, 4: ONLINE }, 1_000);
  try {
    const probe = await probeRawTcp(printer(talks.port), FAST);
    assert.deepEqual(probe, { link: "connected", health: { paper: "ok", cover: "closed" } }, "its idle check: it answers DLE EOT");
    const error = await rejection(printRawTcp(printer(talks.port), SLIP, FAST));
    assert.equal(error.sent, "maybe", "part of the slip may be on paper: the retry says REPRINT");
    assert.equal(error.failure, "write-failed", "a write that failed after bytes went out");
  } finally {
    await talks.close();
  }
  const mute = await fakePrinter(null);
  try {
    const result = await printRawTcp(printer(mute.port), SLIP, FAST);
    assert.equal(result.health, null, "no status, no false REPRINT");
  } finally {
    await mute.close();
  }
});

test("a printer out of paper: the slip is 'maybe' with the link kept, and its paper says out", async () => {
  resetRawTcpMemory();
  const fake = await fakePrinter({ 1: OFFLINE, 2: ONLINE | 0x20, 3: ONLINE, 4: ONLINE | 0x60 });
  try {
    const error = await rejection(printRawTcp(printer(fake.port), SLIP, FAST));
    assert.equal(error.sent, "maybe", "it took the bytes: a REPRINT when it can print again");
    assert.equal(error.failure, "cannot-print", "it says it cannot print");
    assert.deepEqual(error.health, { paper: "out", cover: "closed" }, "what it said");
  } finally {
    await fake.close();
  }
});

test("the idle check: connected with what it says, disconnected when off, connected and silent when it answers no status", async () => {
  resetRawTcpMemory();
  const port = await closedPort();
  assert.deepEqual(await probeRawTcp(printer(port), FAST), { link: "disconnected", health: null }, "off");
  const paperLow = await fakePrinter({ 1: ONLINE, 2: ONLINE, 3: ONLINE, 4: ONLINE | 0x0c });
  try {
    assert.deepEqual(await probeRawTcp(printer(paperLow.port), FAST), { link: "connected", health: { paper: "low", cover: "closed" } }, "low paper");
    assert.equal(paperLow.connections[0]?.length, 12, "the check sends only DLE EOT 1 to 4");
  } finally {
    await paperLow.close();
  }
  const mute = await fakePrinter(null);
  try {
    assert.deepEqual(await probeRawTcp(printer(mute.port), FAST), { link: "connected", health: null }, "it answers the connect, not DLE EOT");
    const started = Date.now();
    await printRawTcp(printer(mute.port), SLIP, FAST);
    assert.ok(Date.now() - started < FAST.afterJobMinMs, "a printer whose last check got no answer is asked briefly after a slip");
  } finally {
    await mute.close();
  }
});

test("one job at a time per printer: a second slip waits for the first to close", async () => {
  resetRawTcpMemory();
  const fake = await fakePrinter({ 1: ONLINE, 2: ONLINE, 3: ONLINE, 4: ONLINE });
  try {
    await Promise.all([printRawTcp(printer(fake.port), SLIP, FAST), printRawTcp(printer(fake.port), SLIP, FAST), probeRawTcp(printer(fake.port), FAST)]);
    assert.equal(fake.maxOpen, 1, "never two connections at once");
    assert.ok(fake.connections.length >= 2, "both slips went out");
  } finally {
    await fake.close();
  }
});

test("a job that outlives its deadline is 'maybe' and frees the printer's line", async () => {
  resetRawTcpMemory();
  const mute = await fakePrinter(null);
  try {
    const slow: RawTcpWaits = { ...FAST, afterJobMinMs: 10_000, afterJobMaxMs: 10_000, jobMs: 300 };
    const started = Date.now();
    const error = await rejection(printRawTcp(printer(mute.port), SLIP, slow));
    assert.equal(error.sent, "maybe", "bytes went out");
    assert.ok(Date.now() - started < 6_000, "the deadline, not the long wait");
    const next = await printRawTcp(printer(mute.port), SLIP, FAST);
    assert.equal(next.health, null, "the next slip prints");
  } finally {
    await mute.close();
  }
});

test("the real waits are the POS app's", () => {
  assert.deepEqual(RAW_TCP_WAITS, { connectMs: 5_000, refusedRetryMs: 1_000, afterJobMinMs: 5_000, afterJobMaxMs: 30_000, replyMs: 1_000, followUpMs: 300, drainMs: 750, jobMs: 60_000 }, "TcpTransport.kt's numbers and its 60 s watchdog");
});
