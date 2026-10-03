import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { DLE, EOT, parseArgs, startFakePrinter, statusByte, statusRequests } from "./fake-escpos-printer.mjs";

async function withPrinter(flags, run) {
  const out = mkdtempSync(path.join(os.tmpdir(), "fake-escpos-test-"));
  const waiters = [];
  const server = startFakePrinter({ ...parseArgs(flags), port: 0, out }, (job) => waiters.shift()?.(job));
  await new Promise((resolve) => server.once("listening", resolve));
  const nextJob = () => new Promise((resolve) => waiters.push(resolve));
  try {
    await run({ port: server.address().port, out, nextJob });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(out, { recursive: true, force: true });
  }
}

function send(port, bytes) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    const received = [];
    let failed = false;
    socket.on("data", (d) => received.push(d));
    socket.on("error", () => (failed = true));
    socket.on("close", () => resolve({ received: Buffer.concat(received), failed }));
    socket.on("connect", () => socket.write(bytes, () => socket.end()));
  });
}

test("parseArgs: safe defaults (loopback, a temp folder) and every flag", () => {
  const d = parseArgs([]);
  assert.equal(d.port, 9100);
  assert.equal(d.host, "127.0.0.1", "never listens on the LAN unless asked");
  assert.ok(d.out.startsWith(os.tmpdir()), "jobs never land in the repo by default");
  const f = parseArgs(["--port", "9101", "--drop-after", "100", "--drop-every", "3", "--delay", "50", "--paper-out", "--cover-open", "--refuse"]);
  assert.deepEqual([f.port, f.dropAfter, f.dropEvery, f.delay, f.paperOut, f.coverOpen, f.refuse], [9101, 100, 3, 50, true, true, true]);
  assert.equal(d.dropEvery, 1, "--drop-after alone cuts every job, as before");
  assert.throws(() => parseArgs(["--bogus"]), /unknown option/);
  assert.throws(() => parseArgs(["--drop-after", "-1"]), /whole number/);
});

test("statusByte: a healthy printer answers 0x12; paper-out and cover-open set the Epson DLE EOT bits", () => {
  const ok = { paperOut: false, coverOpen: false };
  assert.deepEqual([1, 2, 3, 4].map((n) => statusByte(n, ok)), [0x12, 0x12, 0x12, 0x12]);
  assert.equal(statusByte(4, { paperOut: true, coverOpen: false }), 0x72, "n=4: roll paper end");
  assert.equal(statusByte(2, { paperOut: false, coverOpen: true }), 0x16, "n=2: cover open");
  assert.equal(statusByte(1, { paperOut: true, coverOpen: false }), 0x1a, "n=1: offline");
  assert.equal(statusByte(9, ok), null);
});

test("statusRequests: finds DLE EOT n, including one split across two chunks", () => {
  const a = statusRequests(Buffer.from([0x41, DLE, EOT, 4, 0x42, DLE]));
  assert.deepEqual(a.requests, [4]);
  const b = statusRequests(Buffer.concat([a.carry, Buffer.from([EOT, 2])]));
  assert.deepEqual(b.requests, [2]);
  assert.equal(b.carry.length, 0);
});

test("a whole job is saved, with a jobs.log line", async () => {
  await withPrinter([], async ({ port, out, nextJob }) => {
    const job = nextJob();
    await send(port, Buffer.alloc(1_000, 0x55));
    const record = await job;
    assert.equal(record.bytes, 1_000);
    assert.equal(record.dropped, false);
    assert.equal(statSync(record.file).size, 1_000);
    const line = JSON.parse(readFileSync(path.join(out, "jobs.log"), "utf8").trim());
    assert.equal(line.bytes, 1_000);
  });
});

test("--drop-after: the connection is cut mid-job and only the first N bytes are on 'paper'", async () => {
  await withPrinter(["--drop-after", "100"], async ({ port, nextJob }) => {
    const job = nextJob();
    await send(port, Buffer.alloc(64_000, 0x55));
    const record = await job;
    assert.equal(record.dropped, true);
    assert.equal(record.bytes, 100);
    assert.equal(statSync(record.file).size, 100);
  });
});

test("--drop-every: with --drop-after, only every N-th connection is cut (the soak's drops)", async () => {
  await withPrinter(["--drop-after", "100", "--drop-every", "2"], async ({ port, nextJob }) => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      const job = nextJob();
      await send(port, Buffer.alloc(1_000, 0x55));
      results.push(await job);
    }
    assert.deepEqual(results.map((r) => [r.dropped, r.bytes]), [[false, 1_000], [true, 100], [false, 1_000], [true, 100]], "jobs 2 and 4 are cut");
  });
});

test("--paper-out: DLE EOT 4 is answered at once with 'paper end'", async () => {
  await withPrinter(["--paper-out"], async ({ port, nextJob }) => {
    const job = nextJob();
    const { received } = await send(port, Buffer.from([DLE, EOT, 4]));
    assert.deepEqual([...received], [0x72]);
    assert.equal((await job).statusRequests, 1);
  });
});

test("--refuse: every connection is reset as it opens, and nothing is saved", async () => {
  await withPrinter(["--refuse"], async ({ port, nextJob }) => {
    const job = nextJob();
    await send(port, Buffer.alloc(10, 0x55));
    const record = await job;
    assert.equal(record.refused, true);
    assert.equal(record.file, null);
  });
});
