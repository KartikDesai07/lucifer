/**
 * Phase 2 Session 2G (the 2F2 review gate; spec §7.11, §9.1, §17.3): the print soak's own agent, split out of
 * scripts/print-soak.ts. It writes each job it holds to a fake printer over TCP (the job's id first, so the soak's
 * check reads it back, then DLE EOT 1, so a connection the printer cut mid-slip is seen as "maybe") and acks it.
 * Like the page's agent it prints a job an answer carried already leased to it before any lease (decision 15), and
 * leases again only when an ack says `more`, or says nothing, as an older server would (decision 9). A local test
 * tool: console-free, every request through `call`.
 */
import net from "node:net";
import type { LeasedPrintJob, PrintJobRef } from "@pos/shared/print-agent-wire";

export const SOAK_TAB = "soak-tab";
const SLIP_BYTES = 4_096;

export type SoakJson = { data?: Record<string, unknown>; error?: string };
export type SoakCall = (method: string, url: string, body: unknown) => Promise<{ status: number; json: SoakJson }>;
export interface SoakAddress { host: string; port: number }

export interface SoakAgent {
  /** Where each line this soak writes prints: "" is the device's own simple-mode line, else a printer's id. */
  lines: Map<string, SoakAddress>;
  device: string;
  /** --direct: the soak names its tab (and its printers) on every request that makes slips. */
  direct: boolean;
}

/** One write of a job's slip: its id first, then DLE EOT 1. The answer comes only after every byte before it was
 *  read, so a cut connection is a "maybe". */
function writeSlip(address: SoakAddress, job: { id: string; epoch: number; kind: string }): Promise<"printed" | "maybe" | "no"> {
  return new Promise((resolve) => {
    const socket = net.connect(address.port, address.host);
    let connected = false;
    let settled = false;
    const done = (result: "printed" | "maybe" | "no") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(5_000, () => done(connected ? "maybe" : "no"));
    socket.on("error", () => done(connected ? "maybe" : "no"));
    socket.on("close", () => done(connected ? "maybe" : "no"));
    socket.on("data", () => done("printed"));
    socket.on("connect", () => {
      connected = true;
      const head = Buffer.from(`JOB ${job.id} ${job.epoch} ${job.kind}\n`, "utf8");
      socket.write(Buffer.concat([head, Buffer.alloc(SLIP_BYTES - head.length, 0x2e), Buffer.from([0x10, 0x04, 0x01])]));
    });
  });
}

/** The headers a request that makes slips carries: the agent pair always, the lease header (and in printers mode the
 *  printers this soak writes) with --direct, the bill header on a settle. */
export function soakHeaders(agent: SoakAgent, bill: boolean): Record<string, string> {
  const printers = [...agent.lines.keys()].filter((line) => line !== "");
  return {
    "x-pos-print-agent": "1",
    "x-pos-device-id": agent.device,
    ...(bill ? { "x-pos-print-bill": "1" } : {}),
    ...(agent.direct && agent.lines.size > 0 ? { "x-pos-print-lease": SOAK_TAB } : {}),
    ...(agent.direct && printers.length > 0 ? { "x-pos-print-ready": printers.join(",") } : {}),
  };
}

/** Prints one held job on its line's printer (every copy, one write each; a failure after the first copy is a
 *  "maybe") and acks it. True when the agent should lease again: the line holds more, or the server did not say; a
 *  job back in line waits for its own backoff (the page sets a timer from nextAttemptAt; the soak's drain waits). */
export async function printAndAck(agent: SoakAgent, call: SoakCall, job: LeasedPrintJob): Promise<boolean> {
  const address = agent.lines.get(job.printerId ?? "");
  let result: "printed" | "maybe" | "no" = address === undefined ? "no" : "printed";
  for (let copy = 0; address !== undefined && copy < (job.copies ?? 1) && result === "printed"; copy++) {
    const written = await writeSlip(address, job);
    if (written !== "printed") result = copy === 0 ? written : "maybe";
  }
  const body =
    result === "printed"
      ? { deviceId: agent.device, epoch: job.epoch, outcome: "printed" }
      : { deviceId: agent.device, epoch: job.epoch, outcome: "failed", sent: result, error: result === "no" ? "The printer is not connected." : "The printer cut the connection mid-slip." };
  const ack = await call("POST", `/api/print-jobs/${job.id}/ack`, body);
  if (result !== "printed" && typeof ack.json.data?.nextAttemptAt === "string") return false;
  return ack.json.data?.more !== false;
}

/** After a request: prints every job its answer carried leased to this soak, and says whether to lease (an ack said
 *  `more`, or the answer names a queued slip aimed at this device). Without --direct, always (Phase 1's agent). */
export async function printLeased(agent: SoakAgent, call: SoakCall, res: { json: SoakJson }): Promise<boolean> {
  if (agent.lines.size === 0) return false;
  let again = !agent.direct;
  for (const ref of (res.json.data?.printJobs as PrintJobRef[] | undefined) ?? []) {
    if (ref.leased !== undefined) again = (await printAndAck(agent, call, ref.leased)) || again;
    else if (ref.status === "queued" && ref.targetDeviceId === agent.device) again = true;
  }
  return again;
}

/** Leases this soak's lines (each printer it writes, one job per line) and prints what it gets, until an ack says the
 *  lines are empty. Returns when the server says to look again (retryAt), or null. */
export async function leaseLines(agent: SoakAgent, call: SoakCall): Promise<number | null> {
  if (agent.lines.size === 0) return null;
  const printerIds = [...agent.lines.keys()].filter((line) => line !== "");
  for (;;) {
    const lease = await call("POST", "/api/print-jobs/lease", { deviceId: agent.device, tabId: SOAK_TAB, ...(printerIds.length > 0 ? { printerIds } : {}) });
    const jobs = (lease.json.data?.jobs as LeasedPrintJob[] | undefined) ?? [];
    if (jobs.length === 0) {
      const retryAt = lease.json.data?.retryAt;
      return typeof retryAt === "string" ? Date.parse(retryAt) : null;
    }
    let more = false;
    for (const job of jobs) more = (await printAndAck(agent, call, job)) || more;
    if (!more) return null;
  }
}
