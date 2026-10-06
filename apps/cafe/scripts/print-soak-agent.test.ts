import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { leaseLines, printLeased, soakHeaders, type SoakAgent, type SoakCall, type SoakJson } from "./print-soak-agent";

// Phase 2 Session 2G (the 2F2 review gate): the print soak's agent prints a job an answer carried leased to it before
// any lease, writes each printer's jobs to that printer, and leases again only when an ack says `more`, so the soak
// measures Phase 2's requests (decisions 9 and 15), not Phase 1's trailing empty lease.

/** A fake printer: keeps every connection's bytes and answers DLE EOT 1 with a status byte. */
async function fakePrinter(): Promise<{ port: number; jobs: string[]; close: () => Promise<void> }> {
  const jobs: string[] = [];
  const server = net.createServer((socket) => {
    let bytes = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      bytes = Buffer.concat([bytes, chunk]);
      if (bytes.subarray(-3).equals(Buffer.from([0x10, 0x04, 0x01]))) {
        jobs.push(bytes.toString("utf8").split("\n")[0] ?? "");
        socket.end(Buffer.from([0x12]));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { port: address.port, jobs, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function leased(id: string, printerId?: string): LeasedPrintJob {
  return { id, epoch: 1, kind: "kot", label: "KOT", createdAt: new Date(0).toISOString(), payload: {} as LeasedPrintJob["payload"], labels: [], copyIndex: 0, attempt: 1, ...(printerId !== undefined ? { printerId } : {}) };
}

/** A fake server: every request recorded; each ack answers the next `more`, each lease the next job list. */
function fakeServer(acks: boolean[], leases: LeasedPrintJob[][]): { call: SoakCall; seen: string[] } {
  const seen: string[] = [];
  const call: SoakCall = async (method, url, body) => {
    seen.push(`${method} ${url}${url.endsWith("/ack") ? ` ${(body as { outcome: string }).outcome}` : ""}`);
    const json: SoakJson = url.endsWith("/ack") ? { data: { applied: true, more: acks.shift() ?? false } } : { data: { jobs: leases.shift() ?? [], retryAt: null } };
    return { status: 200, json };
  };
  return { call, seen };
}

test("the soak's headers: the agent pair always; with --direct the lease header, and in printers mode the printers it writes", () => {
  const simple: SoakAgent = { lines: new Map([["", { host: "127.0.0.1", port: 9100 }]]), device: "soak-device", direct: false };
  assert.deepEqual(soakHeaders(simple, false), { "x-pos-print-agent": "1", "x-pos-device-id": "soak-device" }, "Phase 1's agent: no lease header");
  assert.deepEqual(soakHeaders({ ...simple, direct: true }, true), { "x-pos-print-agent": "1", "x-pos-device-id": "soak-device", "x-pos-print-bill": "1", "x-pos-print-lease": "soak-tab" }, "simple mode, direct: the lease header, no printers");
  const printers: SoakAgent = { lines: new Map([["p1", { host: "127.0.0.1", port: 9100 }], ["p2", { host: "127.0.0.1", port: 9101 }]]), device: "soak-device", direct: true };
  assert.equal(soakHeaders(printers, false)["x-pos-print-ready"], "p1,p2", "printers mode, direct: the printers it writes");
  assert.equal(soakHeaders({ lines: new Map(), device: "soak-device", direct: true }, false)["x-pos-print-lease"], undefined, "an ordering-only soak never names a tab");
});

test("a job an answer carried leased to the soak prints on its own printer and is acked; no lease after an ack that says the line is empty", async () => {
  const kitchen = await fakePrinter();
  const bar = await fakePrinter();
  try {
    const agent: SoakAgent = { lines: new Map([["p-kitchen", { host: "127.0.0.1", port: kitchen.port }], ["p-bar", { host: "127.0.0.1", port: bar.port }]]), device: "soak-device", direct: true };
    const server = fakeServer([false, false], []);
    const res = { json: { data: { printJobs: [{ id: "a1", status: "leased", targetDeviceId: "soak-device", leased: leased("a1", "p-bar") }, { id: "a2", status: "leased", targetDeviceId: "soak-device", leased: leased("a2", "p-kitchen") }] } } };
    assert.equal(await printLeased(agent, server.call, res), false, "both acks said more: false, so no lease");
    assert.deepEqual(bar.jobs, ["JOB a1 1 kot"], "the bar job on the bar printer");
    assert.deepEqual(kitchen.jobs, ["JOB a2 1 kot"], "the kitchen job on the kitchen printer");
    assert.deepEqual(server.seen, ["POST /api/print-jobs/a1/ack printed", "POST /api/print-jobs/a2/ack printed"], "one ack each, no lease");
    assert.equal(await printLeased(agent, fakeServer([true], []).call, { json: { data: { printJobs: [{ id: "b1", status: "leased", targetDeviceId: "soak-device", leased: leased("b1", "p-bar") }] } } }), true, "an ack that says more asks for a lease");
    assert.equal(await printLeased(agent, fakeServer([], []).call, { json: { data: { printJobs: [{ id: "c1", status: "queued", targetDeviceId: "soak-device" }] } } }), true, "a queued slip aimed at the soak asks for a lease");
    assert.equal(await printLeased(agent, fakeServer([], []).call, { json: { data: { printJobs: [{ id: "d1", status: "queued", targetDeviceId: "the-app" }] } } }), false, "a slip another device prints asks for nothing");
    assert.equal(await printLeased({ ...agent, direct: false }, fakeServer([], []).call, { json: { data: {} } }), true, "without --direct the soak leases after every request (Phase 1's agent)");
    assert.equal(await printLeased({ lines: new Map(), device: "soak-device", direct: false }, fakeServer([], []).call, { json: { data: {} } }), false, "an ordering-only soak never leases");
  } finally {
    await kitchen.close();
    await bar.close();
  }
});

test("a job refused before any byte waits for its own backoff: no lease right after its ack (the page sets a timer)", async () => {
  const agent: SoakAgent = { lines: new Map([["p-bar", { host: "127.0.0.1", port: 1 }]]), device: "soak-device", direct: true };
  const seen: string[] = [];
  const call: SoakCall = async (method, url, body) => {
    seen.push(`${method} ${url} ${(body as { outcome?: string; sent?: string }).outcome ?? ""} ${(body as { sent?: string }).sent ?? ""}`.trim());
    return { status: 200, json: { data: { applied: true, nextAttemptAt: new Date(Date.now() + 30_000).toISOString() } } };
  };
  const res = { json: { data: { printJobs: [{ id: "x1", status: "leased", targetDeviceId: "soak-device", leased: leased("x1", "p-bar") }] } } };
  assert.equal(await printLeased(agent, call, res), false, "back in line with a backoff: no lease now");
  assert.deepEqual(seen, ["POST /api/print-jobs/x1/ack failed no"], "refused before any byte (nothing listens on port 1), acked sent no");
});

test("a lease of two printers' lines prints each job on its printer and stops when the acks say the lines are empty", async () => {
  const kitchen = await fakePrinter();
  const bar = await fakePrinter();
  try {
    const agent: SoakAgent = { lines: new Map([["p-kitchen", { host: "127.0.0.1", port: kitchen.port }], ["p-bar", { host: "127.0.0.1", port: bar.port }]]), device: "soak-device", direct: false };
    const server = fakeServer([false, false], [[leased("k1", "p-kitchen"), leased("b1", "p-bar")]]);
    assert.equal(await leaseLines(agent, server.call), null, "no retryAt: the lines are empty");
    assert.deepEqual(server.seen, ["POST /api/print-jobs/lease", "POST /api/print-jobs/k1/ack printed", "POST /api/print-jobs/b1/ack printed"], "one lease, two acks, no trailing lease");
    assert.deepEqual([kitchen.jobs, bar.jobs], [["JOB k1 1 kot"], ["JOB b1 1 kot"]], "each job on its own printer");
  } finally {
    await kitchen.close();
    await bar.close();
  }
});
