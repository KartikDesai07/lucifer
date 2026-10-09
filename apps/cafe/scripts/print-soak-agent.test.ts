import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { SOAK_PULSE_MS, leaseLines, printLeased, soakHeaders, soakNextLeaseAt, soakTimerDue, type SoakAgent, type SoakCall, type SoakJson } from "./print-soak-agent";

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
    await leaseLines(agent, server.call);
    assert.equal(agent.timerAt ?? null, null, "no retryAt: the lines are empty, no timer");
    assert.deepEqual(server.seen, ["POST /api/print-jobs/lease", "POST /api/print-jobs/k1/ack printed", "POST /api/print-jobs/b1/ack printed"], "one lease, two acks, no trailing lease");
    assert.deepEqual([kitchen.jobs, bar.jobs], [["JOB k1 1 kot"], ["JOB b1 1 kot"]], "each job on its own printer");
  } finally {
    await kitchen.close();
    await bar.close();
  }
});

// Phase 3 Session 3G (Session 2G's m-6, the final Phase 2 gate's (a) item 6): the soak keeps the page's one local timer.
// A job back in line after a refusal or a cut, and a lease answered "not due yet", set it; the soak leases again only when
// it is due (or at its next pulse), never every few seconds during a backoff.
test("a refused job's backoff and a lease's retryAt are the soak's one timer; the drain waits for it, else for its pulse", async () => {
  const agent: SoakAgent = { lines: new Map([["p-bar", { host: "127.0.0.1", port: 1 }]]), device: "soak-device", direct: true };
  const at = Date.now() + 30_000;
  const call: SoakCall = async (_method, url) => {
    if (url.endsWith("/ack")) return { status: 200, json: { data: { applied: true, nextAttemptAt: new Date(at).toISOString() } } };
    return { status: 200, json: { data: { jobs: [], retryAt: new Date(at - 10_000).toISOString() } } };
  };
  const res = { json: { data: { printJobs: [{ id: "x1", status: "leased", targetDeviceId: "soak-device", leased: leased("x1", "p-bar") }] } } };
  assert.equal(await printLeased(agent, call, res), false, "back in line with a backoff: no lease now");
  assert.equal(agent.timerAt, at, "the ack's nextAttemptAt is the timer");
  assert.equal(soakTimerDue(agent, at - 1), false, "not before it");
  assert.equal(soakTimerDue(agent, at), true, "due at it");
  await leaseLines(agent, call);
  assert.equal(agent.timerAt, at - 10_000, "a lease's retryAt that comes sooner moves it");
  const now = Date.now();
  assert.equal(soakNextLeaseAt(agent, now), at - 10_000, "the drain waits for the timer");
  assert.equal(agent.timerAt, null, "and spends it");
  assert.equal(soakNextLeaseAt(agent, now), now + SOAK_PULSE_MS, "no timer: the next pulse");
});

// Phase 3 Session 3G (the owner's token ruling, option A: the measurement runs with a token per order): the soak's page
// says it prints token slips as a page does (print-customization S7: on its lease; Phase 3: on its ack too).
test("the soak's lease and ack say tokenSlips as its page would: page on both, lease on its lease only, none on neither", async () => {
  const printer = await fakePrinter();
  try {
    for (const tokens of ["page", "lease", undefined] as const) {
      const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
      const call: SoakCall = async (_method, url, body) => {
        bodies.push({ url, body: body as Record<string, unknown> });
        return url.endsWith("/ack") ? { status: 200, json: { data: { applied: true, more: false } } } : { status: 200, json: { data: { jobs: bodies.length === 1 ? [leased("t1", "p-counter")] : [], retryAt: null } } };
      };
      const agent: SoakAgent = { lines: new Map([["p-counter", { host: "127.0.0.1", port: printer.port }]]), device: "soak-device", direct: false, ...(tokens === undefined ? {} : { tokens }) };
      await leaseLines(agent, call);
      const lease = bodies.find((b) => b.url.endsWith("/lease"))?.body;
      const ack = bodies.find((b) => b.url.endsWith("/ack"))?.body;
      assert.equal(lease?.tokenSlips, tokens === undefined ? undefined : true, `the lease (${tokens ?? "none"})`);
      assert.equal(ack?.tokenSlips, tokens === "page" ? true : undefined, `the ack (${tokens ?? "none"})`);
    }
  } finally {
    await printer.close();
  }
});

// The final Phase 3 gate (the 3G review's m-1): a refusal before any byte on a network printer's line is acked
// "unreachable", as a Phase 3 page acks it (spec §9.3, P3-3), so a soak writer is skipped for that printer as a page is.
test("a refusal before any byte on a network printer's line says unreachable; a cut, another line or another printer never does", async () => {
  const cutter = net.createServer((socket) => socket.on("data", () => socket.destroy()));
  await new Promise<void>((resolve) => cutter.listen(0, "127.0.0.1", resolve));
  const address = cutter.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  try {
    const bodies: Array<Record<string, unknown>> = [];
    const call: SoakCall = async (_method, _url, body) => {
      bodies.push(body as Record<string, unknown>);
      return { status: 200, json: { data: { applied: true, nextAttemptAt: new Date(Date.now() + 2_000).toISOString() } } };
    };
    const refuses = { host: "127.0.0.1", port: 1 };
    const agent: SoakAgent = {
      lines: new Map([["p-lan", refuses], ["p-cut", { host: "127.0.0.1", port: address.port }], ["p-usb", refuses], ["", refuses]]),
      device: "soak-device",
      direct: true,
      network: new Set(["p-lan", "p-cut"]),
    };
    const held = (id: string, printerId?: string) => ({ id, status: "leased", targetDeviceId: "soak-device", leased: leased(id, printerId) });
    await printLeased(agent, call, { json: { data: { printJobs: [held("n1", "p-lan"), held("c1", "p-cut"), held("u1", "p-usb"), held("s1"), held("o1", "p-elsewhere")] } } });
    assert.deepEqual(
      bodies.map((body) => `${String(body.sent)}:${String(body.reason ?? "-")}`),
      ["no:unreachable", "maybe:-", "no:-", "no:-", "no:-"],
      "only the network printer's refusal before any byte says unreachable (not a cut, a device printer, the simple-mode line or a printer the soak does not write)",
    );
  } finally {
    await new Promise<void>((resolve) => cutter.close(() => resolve()));
  }
});

// The final Phase 3 gate (the 3G review's m-2): the soak's one timer takes the server's time as the page's does
// (printAgentTimerDelayMs: 2 s to 30 s ahead), so a far retryAt or backoff is asked again after 30 s, as a page asks.
test("the server's times set the soak's timer as the page clamps them: at most 30 s ahead, at least 2 s", async () => {
  for (const [ahead, low, high] of [[120_000, 29_000, 30_000], [500, 1_900, 2_000], [-5_000, 1_900, 2_000]] as const) {
    const agent: SoakAgent = { lines: new Map([["p-bar", { host: "127.0.0.1", port: 1 }]]), device: "soak-device", direct: false, timerAt: null };
    const call: SoakCall = async () => ({ status: 200, json: { data: { jobs: [], retryAt: new Date(Date.now() + ahead).toISOString() } } });
    const before = Date.now();
    await leaseLines(agent, call);
    const after = Date.now();
    const at = agent.timerAt ?? 0;
    assert.ok(at >= before + low && at <= after + high, `a retryAt ${ahead} ms ahead: the timer ${at - before} ms ahead (${low}–${high})`);
  }
});
