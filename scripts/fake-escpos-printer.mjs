#!/usr/bin/env node
// A fake ESC/POS LAN printer (spec §13), to test the network print path end to end without hardware.
// Node only, no dependencies. A test tool: nothing here ships to a cafe.
//
//   node scripts/fake-escpos-printer.mjs [--port 9100] [--host 127.0.0.1] [--out <dir>]
//                                        [--drop-after <bytes>] [--delay <ms>]
//                                        [--paper-out] [--cover-open] [--refuse]
//
// The Android emulator reaches it at 10.0.2.2:<port>, the Windows app at 127.0.0.1:<port>. A phone on
// the shop Wi-Fi needs --host 0.0.0.0. Every connection is one job: its bytes go to
// <out>/<time>-<n>.bin and one JSON line to <out>/jobs.log. DLE EOT n (0x10 0x04 n) is answered at
// once, as a real printer answers its real-time status command.
//
//   --drop-after N  cut the connection after N bytes of a job (a slip cut off mid-way: "maybe sent")
//   --delay MS      read nothing for MS after a connection opens (a slow or busy printer)
//   --paper-out     DLE EOT reports "paper end"      --cover-open  DLE EOT reports "cover open"
//   --refuse        reset every connection as it opens (the printer accepts nothing)
// To test "cannot connect" (nothing listening at all), stop this script.

import net from "node:net";
import os from "node:os";
import path from "node:path";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DLE = 0x10;
export const EOT = 0x04;

export function parseArgs(argv) {
  const opts = {
    port: 9100,
    host: "127.0.0.1",
    out: path.join(os.tmpdir(), "fake-escpos-printer"),
    dropAfter: null,
    delay: 0,
    paperOut: false,
    coverOpen: false,
    refuse: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${flag} needs a value`);
      return next;
    };
    const whole = () => {
      const n = Number(value());
      if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} needs a whole number`);
      return n;
    };
    switch (flag) {
      case "--port": opts.port = whole(); break;
      case "--host": opts.host = value(); break;
      case "--out": opts.out = path.resolve(value()); break;
      case "--drop-after": opts.dropAfter = whole(); break;
      case "--delay": opts.delay = whole(); break;
      case "--paper-out": opts.paperOut = true; break;
      case "--cover-open": opts.coverOpen = true; break;
      case "--refuse": opts.refuse = true; break;
      default: throw new Error(`unknown option ${flag}`);
    }
  }
  return opts;
}

/** The byte a printer answers DLE EOT n with (Epson ESC/POS: bits 1 and 4 are always set). */
export function statusByte(n, state) {
  const BASE = 0x12;
  switch (n) {
    case 1: return BASE | (state.paperOut || state.coverOpen ? 0x08 : 0); // bit 3: offline
    case 2: return BASE | (state.coverOpen ? 0x04 : 0) | (state.paperOut ? 0x20 : 0); // bit 2: cover open; bit 5: paper end
    case 3: return BASE; // no error
    case 4: return BASE | (state.paperOut ? 0x60 : 0); // bits 5–6: roll paper end
    default: return null;
  }
}

/** The DLE EOT n requests in `bytes`. A request may straddle two chunks: `carry` is the unfinished
 *  tail (DLE, or DLE EOT) to put in front of the next chunk. */
export function statusRequests(bytes) {
  const requests = [];
  let i = 0;
  let consumed = 0;
  while (i + 2 < bytes.length) {
    if (bytes[i] === DLE && bytes[i + 1] === EOT) {
      requests.push(bytes[i + 2]);
      i += 3;
      consumed = i;
    } else {
      i += 1;
    }
  }
  const n = bytes.length;
  let carry = Buffer.alloc(0);
  if (n - 2 >= consumed && n >= 2 && bytes[n - 2] === DLE && bytes[n - 1] === EOT) carry = bytes.subarray(n - 2);
  else if (n - 1 >= consumed && n >= 1 && bytes[n - 1] === DLE) carry = bytes.subarray(n - 1);
  return { requests, carry };
}

export function startFakePrinter(opts, onJob = () => {}) {
  mkdirSync(opts.out, { recursive: true });
  let seq = 0;
  const server = net.createServer((socket) => {
    const n = ++seq;
    const at = new Date();
    const record = { n, at: at.toISOString(), peer: `${socket.remoteAddress}:${socket.remotePort}`, bytes: 0, dropped: false, refused: false, statusRequests: 0 };
    const chunks = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const name = `${at.toISOString().replace(/[:.]/g, "-")}-${n}.bin`;
      const file = record.refused ? null : path.join(opts.out, name);
      if (file !== null) writeFileSync(file, Buffer.concat(chunks));
      appendFileSync(path.join(opts.out, "jobs.log"), `${JSON.stringify({ ...record, file: file === null ? null : name })}\n`);
      console.log(`job ${n}: ${record.bytes} bytes${record.dropped ? " (dropped)" : ""}${record.refused ? " (refused)" : ""}`);
      onJob({ ...record, file });
    };
    socket.on("error", () => {}); // a reset from either side is a normal end of a job here
    socket.on("close", finish);
    if (opts.refuse) {
      record.refused = true;
      socket.resetAndDestroy();
      return;
    }
    let carry = Buffer.alloc(0);
    if (opts.delay > 0) {
      socket.pause();
      setTimeout(() => socket.resume(), opts.delay);
    }
    socket.on("data", (chunk) => {
      if (record.dropped) return;
      let data = chunk;
      if (opts.dropAfter !== null && record.bytes + data.length > opts.dropAfter) {
        data = data.subarray(0, opts.dropAfter - record.bytes);
        record.dropped = true;
      }
      chunks.push(data);
      record.bytes += data.length;
      const scan = statusRequests(Buffer.concat([carry, data]));
      carry = scan.carry;
      for (const request of scan.requests) {
        record.statusRequests += 1;
        const reply = statusByte(request, opts);
        if (reply !== null && !socket.destroyed) socket.write(Buffer.from([reply]));
      }
      if (record.dropped) socket.destroy();
    });
  });
  server.listen(opts.port, opts.host);
  return server;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const opts = parseArgs(process.argv.slice(2));
  const server = startFakePrinter(opts);
  server.on("listening", () => console.log(`fake ESC/POS printer on ${opts.host}:${server.address().port}; jobs in ${opts.out}`));
  server.on("error", (error) => {
    console.error(error.message);
    process.exit(1);
  });
}
