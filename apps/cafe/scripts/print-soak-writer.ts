/**
 * Phase 3 Session 3G (the Phase 3 plan's 3G spec: the soak's --failover mode): a soak writer that behaves as a printers-mode
 * writer's page does (spec §9.1, §9.3): it polls the wake at the page's cadence with its heartbeat (it may take network
 * printers over: `lanFailover`; it prints tokens as its page says; how the printers it writes now are), and when the wake
 * counts a job for it, it leases its own printers and every network printer it may take over (a page names each one its
 * app reaches; the server grants only the lines it writes now), prints on the fake printers and acks (the soak agent's
 * printAndAck). A stopped writer sends nothing: its page is closed. Locally there is no realtime Worker, so, like the
 * pages the harness measures, it hears of a slip at its next wake. A local test tool: console-free.
 */
import { printAgentWakeIntervalMs, type PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { PRINT_WAKE_SLOW_MS } from "@pos/shared/print-job";
import { leaseLines, type SoakAddress, type SoakAgent, type SoakCall } from "./print-soak-agent";

export interface SoakWriter {
  device: string;
  /** The printers the setup names it the writer of: id -> the fake printer's address. */
  own: Map<string, SoakAddress>;
  /** Every other network printer of the setup (id -> its address in the setup): it may take one over. */
  candidates: Map<string, SoakAddress>;
  tokens?: "page" | "lease";
  /** Its page is closed: no wake, no lease, no ack. */
  stopped: boolean;
  lastJobAt: number | null;
  /** The wake's last answer: the network printers it writes now that the setup names another device for. */
  takenOver: string[];
}

/** The heartbeat a POS app page on bridge v2 sends (Session 3B's wake): it may take network printers over, and says how
 *  each printer it writes now is (the soak's fake printers always answer). A page also names the takeover candidates its
 *  app holds ahead of time; their reports write nothing while it does not write them (health only from the writer now, a
 *  skip only on "disconnected"), so the soak leaves them out. */
export function soakWakeBody(w: SoakWriter): Record<string, unknown> {
  return {
    deviceId: w.device,
    label: `Soak ${w.device}`,
    shell: "android",
    capabilities: { lan: true, bluetooth: false, usb: false, windowsPrinters: false, webSerial: false, webBluetooth: false, lanFailover: true },
    appVersion: "soak",
    nativeProtocol: 2,
    ...(w.tokens === "page" ? { tokenSlips: true } : {}),
    printers: [...w.own.keys(), ...w.takenOver.filter((id) => !w.own.has(id))].map((printerId) => ({ printerId, link: "connected" })),
  };
}

/** One wake, and the lease and prints a job for it calls for. Returns how long until the next wake (the page's cadence,
 *  with no realtime socket: 3 s for two minutes after a job, else 15 s). */
export async function soakWriterTick(w: SoakWriter, call: SoakCall, now: () => number): Promise<number> {
  if (w.stopped) return PRINT_WAKE_SLOW_MS;
  const wake = await call("POST", "/api/print-jobs/wake", soakWakeBody(w));
  const data = wake.json.data ?? {};
  w.takenOver = Array.isArray(data.takenOver) ? data.takenOver.filter((id): id is string => typeof id === "string") : [];
  const jobs = data.jobsForMe as PrintJobsForMe | undefined;
  if (!w.stopped && (jobs?.count ?? 0) > 0) {
    w.lastJobAt = now();
    const agent: SoakAgent = { lines: new Map([...w.own, ...w.candidates]), device: w.device, direct: false, ...(w.tokens !== undefined ? { tokens: w.tokens } : {}), timerAt: null, closed: () => w.stopped };
    await leaseLines(agent, call);
  }
  const interval = printAgentWakeIntervalMs({ socketHealthy: false, msSinceLastJob: w.lastJobAt === null ? null : now() - w.lastJobAt, capSpent: false });
  return interval === false ? PRINT_WAKE_SLOW_MS : interval;
}

/** P3-4: the primary is seen offline at most 90 s after it stops; a slip that waited for it moves at the next sweep. */
export const SOAK_FAILOVER_SEEN_OFFLINE_MS = 90_000;
export const SOAK_FAILOVER_WAITING_MS = 150_000;

interface FailoverJob {
  printerId?: string;
  createdAt: Date;
  status: string;
  log?: ReadonlyArray<{ event: string; at: Date; deviceId?: string }>;
}

/** The failover checks, by P3-4's measure, over the jobs on the printers the stopped writer wrote: every slip made 90 s or
 *  more after the stop printed by the second device; every slip made before that and not printed before the stop
 *  ("waited through the stop") printed by the second device within 150 s of the stop. A slip the stopped writer had
 *  leased before the stop and finished then is its own (the soak's writer completes the request it was in; a closed
 *  page's slip would expire into one labelled REPRINT instead, P3-4). */
export function failoverProblems(input: { stopAt: number; primary: string; second: string; printerIds: ReadonlySet<string>; jobs: readonly FailoverJob[] }): {
  problems: string[];
  report: { waitingAtStop: number; slowestWaitingS: number; madeAfter90s: number; firstBySecondS: number | null; printedBySecond: number };
} {
  const problems: string[] = [];
  const seconds = (ms: number) => Math.round(ms / 100) / 10;
  let waitingAtStop = 0;
  let slowest = 0;
  let madeAfter = 0;
  let first: number | null = null;
  let bySecond = 0;
  for (const job of input.jobs) {
    if (job.printerId === undefined || !input.printerIds.has(job.printerId)) continue;
    const made = job.createdAt.getTime() - input.stopAt;
    const printed = [...(job.log ?? [])].reverse().find((entry) => entry.event === "printed");
    const at = printed === undefined ? null : printed.at.getTime() - input.stopAt;
    if (printed?.deviceId === input.second && at !== null) {
      bySecond += 1;
      first = first === null ? at : Math.min(first, at);
    }
    if (at !== null && at < 0) continue;
    const leasedBefore = (job.log ?? []).some((entry) => entry.event === "leased" && entry.deviceId === input.primary && entry.at.getTime() < input.stopAt);
    if (printed?.deviceId === input.primary && leasedBefore) continue;
    const name = `the slip made ${seconds(made)} s after the stop`;
    if (made >= SOAK_FAILOVER_SEEN_OFFLINE_MS) {
      madeAfter += 1;
      if (job.status !== "printed" || printed === undefined) problems.push(`${name}: not printed (${job.status})`);
      else if (printed.deviceId !== input.second) problems.push(`${name}: printed by ${printed.deviceId ?? "?"}, not the second device`);
      continue;
    }
    waitingAtStop += 1;
    if (job.status !== "printed" || printed === undefined || at === null) problems.push(`${name}: waited through the stop, not printed (${job.status})`);
    else if (printed.deviceId !== input.second) problems.push(`${name}: waited through the stop, printed by ${printed.deviceId ?? "?"}`);
    else if (at > SOAK_FAILOVER_WAITING_MS) problems.push(`${name}: waited through the stop, printed ${seconds(at)} s after it (more than 150 s)`);
    else slowest = Math.max(slowest, at);
  }
  return { problems, report: { waitingAtStop, slowestWaitingS: seconds(slowest), madeAfter90s: madeAfter, firstBySecondS: first === null ? null : seconds(first), printedBySecond: bySecond } };
}
