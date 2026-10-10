import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";

import { PRINT_WAKE_FAST_MS, PRINT_WAKE_SLOW_MS } from "@pos/shared/print-job";
import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import type { SoakCall, SoakJson } from "./print-soak-agent";
import { failoverProblems, soakWakeBody, soakWriterTick, type SoakWriter } from "./print-soak-writer";

// Phase 3 Session 3G (the Phase 3 plan's 3G spec: "a --failover mode, a second soak agent that says lanFailover"): two
// soak writers that behave as the POS app's page in printers mode does (spec §9.1, §9.3): each polls the wake at the
// page's cadence with its heartbeat (lanFailover, its printers' health), and when the wake counts a job for it leases its
// own printers and every network printer it may take over (the server grants only the ones it writes now).

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

function leased(id: string, printerId: string): LeasedPrintJob {
  return { id, epoch: 1, kind: "kot", label: "KOT", createdAt: new Date(0).toISOString(), payload: {} as LeasedPrintJob["payload"], labels: [], copyIndex: 0, attempt: 1, printerId };
}

function writer(own: number, candidate: number): SoakWriter {
  return { device: "soak-b", own: new Map([["p-bar", { host: "127.0.0.1", port: own }]]), candidates: new Map([["p-kitchen", { host: "127.0.0.1", port: candidate }]]), tokens: "page", stopped: false, lastJobAt: null, takenOver: [] };
}

test("the writer's heartbeat says it may take network printers over, that it prints tokens, and how the printers it writes now are", () => {
  const w = { ...writer(9101, 9100), takenOver: ["p-kitchen"] };
  assert.deepEqual(soakWakeBody(w), {
    deviceId: "soak-b",
    label: "Soak soak-b",
    shell: "android",
    capabilities: { lan: true, bluetooth: false, usb: false, windowsPrinters: false, webSerial: false, webBluetooth: false, lanFailover: true },
    appVersion: "soak",
    nativeProtocol: 2,
    tokenSlips: true,
    printers: [{ printerId: "p-bar", link: "connected" }, { printerId: "p-kitchen", link: "connected" }],
  });
  assert.equal(soakWakeBody({ ...w, tokens: "lease" }).tokenSlips, undefined, "a page from before Phase 3 says nothing on its wake");
});

test("a wake that counts no job asks nothing more and comes back at the slow cadence; one that counts a job leases every line it may print, prints, and comes back fast", async () => {
  const bar = await fakePrinter();
  const kitchen = await fakePrinter();
  try {
    const w = writer(bar.port, kitchen.port);
    const seen: string[] = [];
    let count = 0;
    const leases: LeasedPrintJob[][] = [[leased("k1", "p-kitchen")]];
    const call: SoakCall = async (method, url, body) => {
      seen.push(`${method} ${url}${url.endsWith("/lease") ? ` ${JSON.stringify((body as { printerIds?: string[] }).printerIds)}` : ""}`);
      let json: SoakJson;
      if (url.endsWith("/wake")) json = { data: { jobsForMe: { count, oldestCreatedAt: null }, agents: 2, agentDailyCap: 7_000, serverNow: new Date().toISOString(), takenOver: count > 0 ? ["p-kitchen"] : [] } };
      else if (url.endsWith("/lease")) json = { data: { jobs: leases.shift() ?? [], retryAt: null } };
      else json = { data: { applied: true, more: false } };
      return { status: 200, json };
    };
    let now = 1_000_000;
    assert.equal(await soakWriterTick(w, call, () => now), PRINT_WAKE_SLOW_MS, "nothing for it: 15 s");
    assert.deepEqual(seen, ["POST /api/print-jobs/wake"], "a wake only");
    count = 1;
    now += PRINT_WAKE_SLOW_MS;
    assert.equal(await soakWriterTick(w, call, () => now), PRINT_WAKE_FAST_MS, "a job: 3 s for the next two minutes");
    assert.deepEqual(seen.slice(1), ["POST /api/print-jobs/wake", 'POST /api/print-jobs/lease ["p-bar","p-kitchen"]', "POST /api/print-jobs/k1/ack"], "its own printer and the one it may take over, then the ack");
    assert.deepEqual(kitchen.jobs, ["JOB k1 1 kot"], "the taken-over slip on the kitchen's printer");
    assert.deepEqual(w.takenOver, ["p-kitchen"], "the wake's answer: what it writes now");
    w.stopped = true;
    const before = seen.length;
    await soakWriterTick(w, call, () => now);
    assert.equal(seen.length, before, "a stopped writer sends nothing (its page is closed)");
    // The gate's pre-run: a writer stopped in the middle of a burst finished its lease's slip, then leased again (its ack
    // said more): it stops at the slip it holds.
    const busy = writer(bar.port, kitchen.port);
    const burst: string[] = [];
    const more: SoakCall = async (_method, url) => {
      burst.push(url);
      if (url.endsWith("/wake")) return { status: 200, json: { data: { jobsForMe: { count: 2, oldestCreatedAt: null }, agents: 2, agentDailyCap: 7_000, serverNow: new Date().toISOString() } } };
      if (url.endsWith("/lease")) return { status: 200, json: { data: { jobs: burst.length < 6 ? [leased(`m${burst.length}`, "p-bar")] : [], retryAt: null } } };
      busy.stopped = true;
      return { status: 200, json: { data: { applied: true, more: true } } };
    };
    await soakWriterTick(busy, more, () => now);
    assert.deepEqual(burst.map((url) => url.replace(/\/m\d+\//, "/:id/")), ["/api/print-jobs/wake", "/api/print-jobs/lease", "/api/print-jobs/:id/ack"], "stopped while it printed: its ack goes, no lease after it");
  } finally {
    await bar.close();
    await kitchen.close();
  }
});

// The final Phase 3 gate (the 3G review's m-1): the writer's page acks a refusal before any byte on a network printer
// "unreachable" (spec §9.3, P3-3), so the server skips it for that printer as it skips a Phase 3 page.
test("a writer that cannot reach a network printer it was given acks unreachable", async () => {
  const w: SoakWriter = { ...writer(1, 1), network: new Set(["p-kitchen"]) };
  const acks: Array<Record<string, unknown>> = [];
  const call: SoakCall = async (_method, url, body) => {
    if (url.endsWith("/wake")) return { status: 200, json: { data: { jobsForMe: { count: 1, oldestCreatedAt: null }, agents: 2, agentDailyCap: 7_000, serverNow: new Date().toISOString(), takenOver: ["p-kitchen"] } } };
    if (url.endsWith("/lease")) return { status: 200, json: { data: { jobs: acks.length === 0 ? [leased("k1", "p-kitchen")] : [], retryAt: null } } };
    acks.push(body as Record<string, unknown>);
    return { status: 200, json: { data: { applied: true, more: false } } };
  };
  await soakWriterTick(w, call, () => 1_000_000);
  assert.deepEqual(acks.map((ack) => `${String(ack.outcome)}:${String(ack.sent)}:${String(ack.reason ?? "-")}`), ["failed:no:unreachable"], "the kitchen's network printer refused before any byte");
});

test("failover is checked by P3-4's measure: a slip made 90 s or more after the primary stopped printed by the second device; one waiting at the stop within 150 s", () => {
  const stopAt = Date.parse("2026-10-09T12:00:00Z");
  const at = (s: number) => new Date(stopAt + s * 1_000);
  const job = (made: number, printed: number | null, by: string, printerId = "p-kitchen") => ({
    printerId,
    createdAt: at(made),
    status: printed === null ? "queued" : "printed",
    log: printed === null ? [{ event: "created", at: at(made) }] : [{ event: "created", at: at(made) }, { event: "printed", at: at(printed), deviceId: by }],
  });
  const good = [job(-30, -29, "soak-a"), job(-5, 120, "soak-b"), job(40, 130, "soak-b"), job(95, 96, "soak-b"), job(100, 101, "soak-b", "p-bar")];
  const ok = failoverProblems({ stopAt, primary: "soak-a", second: "soak-b", printerIds: new Set(["p-kitchen"]), jobs: good });
  assert.deepEqual(ok.problems, [], "all within P3-4's bounds");
  assert.deepEqual(ok.report, { waitingAtStop: 2, slowestWaitingS: 130, madeAfter90s: 1, firstBySecondS: 96, printedBySecond: 3 });
  const bad = failoverProblems({ stopAt, primary: "soak-a", second: "soak-b", printerIds: new Set(["p-kitchen"]), jobs: [job(-5, 170, "soak-b"), job(100, 101, "soak-a"), job(120, null, "")] });
  assert.equal(bad.problems.length, 3, bad.problems.join("; "));
  // The gate's pre-run: the soak's writer was mid-request at the stop and finished the slip it had leased just before.
  const inFlight = { ...job(-2, 1, "soak-a"), log: [{ event: "created", at: at(-2) }, { event: "leased", at: at(-1), deviceId: "soak-a" }, { event: "printed", at: at(1), deviceId: "soak-a" }] };
  assert.deepEqual(failoverProblems({ stopAt, primary: "soak-a", second: "soak-b", printerIds: new Set(["p-kitchen"]), jobs: [inFlight] }).problems, [], "the stopped writer's last request is its own");
  const after = { ...job(-2, 3, "soak-a"), log: [{ event: "created", at: at(-2) }, { event: "leased", at: at(2), deviceId: "soak-a" }, { event: "printed", at: at(3), deviceId: "soak-a" }] };
  assert.equal(failoverProblems({ stopAt, primary: "soak-a", second: "soak-b", printerIds: new Set(["p-kitchen"]), jobs: [after] }).problems.length, 1, "a lease after the stop is not");
});
