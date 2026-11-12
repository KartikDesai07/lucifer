import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { createPrintAgent } from "@/lib/print-agent";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import type { PendingPrintAck, PrintAgent, PrintAgentResult } from "@/lib/print-agent-types";
import { createWorldClock, createWorldServer, type ScenarioName } from "@/lib/print-lines-world-clock";
import { PRINTER_WRITE_FAILED_MESSAGE } from "@/lib/printer/web-printer-types";

// Test support (NOT app code: no app file imports it). Printing Phase 6 Task 1 (spec §9 rulings 17, 19, 25, 26): the
// scenario world. A fake server with lines and a hand-cranked clock (lib/print-lines-world-clock.ts), a fake surface
// (the bridge: one step or two), and the REAL agent (createPrintAgent), driven only through the PrintAgentDeps below and
// the PrintAgent methods, never its internals, so Task 5's agent per line runs the same scenarios unchanged.
// lib/print-lines-today.test.ts pins TODAY on today's agent. The scenarios' names, jobs and TODAY live in the clock file.

export { SCENARIO_JOBS, TODAY } from "@/lib/print-lines-world-clock";
export type { ScenarioName } from "@/lib/print-lines-world-clock";

export interface WorldOptions {
  /** Phase 6 (§4.1): the surface is held only while drawing, and a station line's write then runs on its line. */
  twoStep: boolean;
  /** One draw on the surface, ms (default 550). */
  drawMs?: number;
  /** One write, ms per line (default 5). */
  writeMs?: Record<string, number>;
}

export interface WorldCounts {
  leases: number;
  emptyLeases: number;
  acks: number;
  printedAcks: number;
  handBacks: number;
}

/** One write on paper. Times are ms since the scenario began (after the start-up): drawnAt the draw ended (the bytes
 *  exist), firstByteAt the write began, cutAt the write ended. */
export interface PaperRecord {
  id: string;
  line: string;
  drawnAt: number;
  firstByteAt: number;
  cutAt: number;
}

export interface LinesWorld {
  agent: PrintAgent;
  /** Queued jobs at the tail of a line (a printer id, or "" = PRINT_DEVICE_LINE), as another device's round makes them. */
  queue(line: string, ...ids: string[]): void;
  /** Jobs made already leased to this tab (direct print, §7.11), handed to agent.take in order. */
  deliver(...jobs: Array<{ id: string; line: string }>): void;
  /** A print-status frame: agent.kick(line, jobId) (a device-line job's frame names no printer, as the page's); none: kick(). */
  frame(line?: string, jobId?: string): void;
  /** Beside the brief's interface: a scenario step at now() + ms on the world's clock. */
  at(ms: number, step: () => void): void;
  /** Beside the brief's interface, read live: the write times per line (WorldOptions.writeMs, then a scenario's own),
   *  and the station lines readyPrinters() answers (default K, B, D; simple mode []). */
  writeMs: Record<string, number>;
  stations: string[];
  /** Read live (the final review's fix wave): jobs whose first write fails "may have printed": not on paper, and the
   *  server puts each back for its second attempt. */
  failOnce: Set<string>;
  /** Runs the clock event by event until nothing is pending, or maxMs (default 200 000) passed. */
  settle(maxMs?: number): Promise<void>;
  counts(): WorldCounts;
  paper(): PaperRecord[];
  now(): number;
}

const STATIONS = ["K", "B", "D"] as const;
const LEASE_ANSWER_MS = 30;
const ACK_ANSWER_MS = 20;
const DRAW_MS = 550;
const WRITE_MS = 5;
const SETTLE_MS = 200_000;
/** The agent's hand-back errors (a held job dropped unprinted, sent back to its line). Mirrors lib/print-line-job.ts's
 *  two strings HELD_TOO_LONG and PRINTING_STOPPED: a rewording there must update it here. */
const HAND_BACK_ERRORS: ReadonlySet<string> = new Set(["held too long on this device", "printing stopped on this device"]);

type Slip = { job: LeasedPrintJob; line: string; resolve: (result: PrintAgentResult) => void };

const zeroCounts = (): WorldCounts => ({ leases: 0, emptyLeases: 0, acks: 0, printedAcks: 0, handBacks: 0 });
/** The page's line rule (hooks/use-print-agent.ts). */
const lineOf = (job: LeasedPrintJob): string => job.printerId ?? PRINT_DEVICE_LINE;

export function createLinesWorld(options: WorldOptions): LinesWorld {
  const drawMs = options.drawMs ?? DRAW_MS;
  const clock = createWorldClock();
  const server = createWorldServer(clock);
  const counts = zeroCounts();
  let origin = clock.now();

  // ── The surface: one draw at a time, first in first out. One step (today's bridge): held from the draw's start to the
  // write's end. Two steps: held while drawing; the write then runs on its line's lane. A device-line slip is always one
  // step (ruling 8). busy = the surface is held; the page's effect passes it on after the render (after the agent's own
  // continuation), so the gate is set one event later, and only when it changed. ──
  const draws: Slip[] = [];
  const laneFreeAt = new Map<string, number>();
  const records: PaperRecord[] = [];
  let surfaceHeld = false;
  let gateBusy = false;
  let gateQueued = false;
  function holdSurface(held: boolean): void {
    surfaceHeld = held;
    if (gateQueued) return;
    gateQueued = true;
    clock.later(0, () => {
      gateQueued = false;
      if (gateBusy === surfaceHeld) return;
      gateBusy = surfaceHeld;
      agent.setGate({ enabled: true, busy: gateBusy });
    });
  }
  function freeSurface(): void {
    holdSurface(false);
    startDraw();
  }
  function startDraw(): void {
    if (surfaceHeld) return;
    const slip = draws.shift();
    if (slip === undefined) return;
    holdSurface(true);
    clock.later(drawMs, () => {
      const drawnAt = clock.now();
      const oneStep = !options.twoStep || slip.line === PRINT_DEVICE_LINE;
      if (!oneStep) freeSurface();
      const start = Math.max(drawnAt, laneFreeAt.get(slip.line) ?? drawnAt);
      const end = start + (world.writeMs[slip.line] ?? WRITE_MS);
      laneFreeAt.set(slip.line, end);
      clock.later(end - drawnAt, () => {
        const failed = world.failOnce.delete(slip.job.id);
        if (!failed) records.push({ id: slip.job.id, line: slip.line, drawnAt: drawnAt - origin, firstByteAt: start - origin, cutAt: end - origin });
        slip.resolve(failed ? { ok: false, error: new Error(PRINTER_WRITE_FAILED_MESSAGE) } : { ok: true });
        if (oneStep) freeSurface();
      });
    });
  }

  // ── The agent's other deps (the page's): ready printers, its line rule, a printer always ready, the store in memory ──
  let pending: PendingPrintAck[] = [];
  const printerState = {};
  const agent = createPrintAgent({
    deviceId: "dev-lines",
    lease(printerIds) {
      const data = server.lease(printerIds);
      counts.leases += 1;
      if (data.jobs.length === 0) counts.emptyLeases += 1;
      return clock.answer(LEASE_ANSWER_MS, data);
    },
    ack(id, body) {
      counts.acks += 1;
      if (body.outcome === "printed") counts.printedAcks += 1;
      else if (body.sent === "no" && HAND_BACK_ERRORS.has(body.error ?? "")) counts.handBacks += 1;
      return clock.answer(ACK_ANSWER_MS, server.ack(id, body));
    },
    print: (job) =>
      new Promise((resolve) => {
        draws.push({ job, line: lineOf(job), resolve });
        startDraw();
      }),
    printerReady: () => true,
    printerState: () => printerState,
    readyPrinters: () => world.stations,
    lineOf,
    readPending: () => [...pending],
    writePending: (entries) => void (pending = [...entries]),
    offline: () => false,
    now: clock.now,
    setTimer: (fn, ms) => clock.later(ms, fn),
    clearTimer: clock.cancel,
  });

  // ── Start-up: the gate opens now (the page's mount); the first settle() lets the mount's lease answer (empty), then
  // zeroes every count and starts the scenario's time. Steps asked for before that run right after it, in order. ──
  let started = false;
  const early: Array<() => void> = [];
  const act = (step: () => void): void => void (started ? step() : early.push(step));

  const world: LinesWorld = {
    agent,
    queue: (line, ...ids) => act(() => ids.forEach((id) => server.queue(line, id))),
    deliver: (...jobs) =>
      act(() => {
        const made = jobs.map(({ id, line }) => server.deliver(line, id));
        for (const job of made) agent.take(job);
      }),
    // Phase 6 Task 5 (spec §9 ruling 25): the frame names its job, as the page's (hooks/use-print-agent.ts).
    frame: (line, jobId) => act(() => agent.kick(line === undefined || line === PRINT_DEVICE_LINE ? undefined : line, jobId)),
    at: (ms, step) => act(() => void clock.later(ms, step)),
    writeMs: { ...options.writeMs },
    stations: [...STATIONS],
    failOnce: new Set<string>(),
    async settle(maxMs = SETTLE_MS) {
      if (!started) {
        await clock.run(SETTLE_MS);
        Object.assign(counts, zeroCounts());
        records.length = 0;
        origin = clock.now();
        started = true;
        for (const step of early.splice(0)) step();
      }
      await clock.run(maxMs);
    },
    counts: () => ({ ...counts }),
    paper: () => [...records],
    now: () => clock.now() - origin,
  };
  agent.setGate({ enabled: true, busy: false });
  return world;
}

// ── The scenarios (§9 ruling 26): three station lines K, B, D unless said ──

function framesApart(w: LinesWorld, gapMs: number): void {
  for (const line of STATIONS) w.queue(line, `${line}1`);
  STATIONS.forEach((line, i) => w.at(i * gapMs, () => w.frame(line, `${line}1`)));
}
function backlog(w: LinesWorld): void {
  w.queue("K", "K1", "K2");
  w.queue("B", "B1", "B2");
  w.queue("D", "D1");
  w.frame();
}
const firstOf = (...lines: string[]) => lines.map((line) => ({ id: `${line}1`, line }));

export const SCENARIOS: Record<ScenarioName, (world: LinesWorld) => Promise<void>> = {
  direct: async (w) => w.deliver(...firstOf(...STATIONS)),
  // The B and D frames land while the lease is on its way (it answers at 30 ms).
  frames: async (w) => framesApart(w, 5),
  // They land after the lease answered, while B1 and D1 are held.
  framesLate: async (w) => framesApart(w, 130),
  // A frame for the line that is writing (B and D idle).
  frameBusy: async (w) => {
    w.writeMs.K = 2_000;
    w.deliver(...firstOf("K"));
    w.at(600, () => {
      w.queue("K", "K2");
      w.frame("K", "K2");
    });
  },
  // A frame for an idle line while K writes.
  frameFree: async (w) => {
    w.writeMs.K = 2_000;
    w.deliver(...firstOf("K"));
    w.at(600, () => {
      w.queue("B", "B1");
      w.frame("B", "B1");
    });
  },
  backlog: async (w) => backlog(w),
  backlogSlow: async (w) => {
    for (const line of STATIONS) w.writeMs[line] = 2_000;
    backlog(w);
  },
  stuck: async (w) => {
    w.writeMs.K = 60_000;
    w.deliver(...firstOf(...STATIONS));
  },
  // The device line only (readyPrinters() answers none).
  simple: async (w) => {
    w.stations = [];
    w.queue(PRINT_DEVICE_LINE, "J1", "J2");
    w.frame();
  },
  // The final review's fix wave (I-1): every line holds two, so each wave's last line has more too.
  backlogEven: async (w) => {
    for (const line of STATIONS) w.queue(line, `${line}1`, `${line}2`);
    w.frame();
  },
  // (I-2) Simple mode: J1's first write fails "maybe" (back for its second attempt 2 s later); the pulse kicks meanwhile.
  retryKick: async (w) => {
    w.stations = [];
    w.failOnce.add("J1");
    w.queue(PRINT_DEVICE_LINE, "J1");
    w.frame();
    w.at(300, () => w.frame());
  },
  // (I-2) K1's first write fails "maybe" while B prints B1 to B3; no kick but the first.
  retryBesideBacklog: async (w) => {
    w.failOnce.add("K1");
    w.queue("K", "K1");
    w.queue("B", "B1", "B2", "B3");
    w.frame();
  },
};
