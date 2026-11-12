import type { LeasedPrintJob } from "@pos/shared/print-agent-wire";
import { createPrintAgent } from "@/lib/print-agent";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import type { PendingPrintAck, PrintAgent, PrintAgentResult } from "@/lib/print-agent-types";
import { createWorldClock, createWorldServer } from "@/lib/print-lines-world-clock";

// Test support (NOT app code: no app file imports it). Printing Phase 6 Task 1 (spec §9 rulings 17, 19, 25, 26): the
// scenario world. A fake server with lines and a hand-cranked clock (lib/print-lines-world-clock.ts), a fake surface
// (the bridge: one step or two), and the REAL agent (createPrintAgent), driven only through the PrintAgentDeps below and
// the PrintAgent methods, never its internals, so Task 5's agent per line runs the same scenarios unchanged.
// lib/print-lines-today.test.ts pins TODAY on today's agent.

export type ScenarioName = "direct" | "frames" | "framesLate" | "frameBusy" | "frameFree" | "backlog" | "backlogSlow" | "stuck" | "simple";

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
  /** A print-status frame: agent.kick(line) (a device-line job's frame names no printer, as the page's); none: kick(). */
  frame(line?: string, jobId?: string): void;
  /** Beside the brief's interface: a scenario step at now() + ms on the world's clock. */
  at(ms: number, step: () => void): void;
  /** Beside the brief's interface, read live: the write times per line (WorldOptions.writeMs, then a scenario's own),
   *  and the station lines readyPrinters() answers (default K, B, D; simple mode []). */
  writeMs: Record<string, number>;
  stations: string[];
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
/** The agent's hand-back errors (a held job dropped unprinted, sent back to its line). Mirrors lib/print-agent.ts's two
 *  strings HELD_TOO_LONG and PRINTING_STOPPED: a rewording there must update it here. */
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
        records.push({ id: slip.job.id, line: slip.line, drawnAt: drawnAt - origin, firstByteAt: start - origin, cutAt: end - origin });
        slip.resolve({ ok: true });
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
    // Task 5 passes the job id on: agent.kick(line, jobId).
    frame: (line, _jobId) => act(() => agent.kick(line === undefined || line === PRINT_DEVICE_LINE ? undefined : line)),
    at: (ms, step) => act(() => void clock.later(ms, step)),
    writeMs: { ...options.writeMs },
    stations: [...STATIONS],
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
};

/** The jobs each scenario makes: each must reach paper exactly once. */
export const SCENARIO_JOBS: Record<ScenarioName, readonly string[]> = {
  direct: ["K1", "B1", "D1"],
  frames: ["K1", "B1", "D1"],
  framesLate: ["K1", "B1", "D1"],
  frameBusy: ["K1", "K2"],
  frameFree: ["K1", "B1"],
  backlog: ["K1", "K2", "B1", "B2", "D1"],
  backlogSlow: ["K1", "K2", "B1", "B2", "D1"],
  stuck: ["K1", "B1", "D1"],
  simple: ["J1", "J2"],
};

/** Today's agent (one slip at a time) on a one-step surface: traced by hand through `main`'s agent, then measured in
 *  this world (lib/print-lines-today.test.ts); the "before" of S4 (ruling 26). Every measured count equals the traced. */
export const TODAY: Record<ScenarioName, { leases: number; acks: number }> = {
  // The held jobs print one by one; each ack says no more.
  direct: { leases: 0, acks: 3 },
  // One lease takes the three heads; the frames that landed during the cycle buy one trailing (empty) lease.
  frames: { leases: 2, acks: 3 },
  // The same: a frame during a cycle waits for it and leases once after it.
  framesLate: { leases: 2, acks: 3 },
  // K1's ack says more (K2): one lease after it.
  frameBusy: { leases: 1, acks: 2 },
  // The frame waits for K1's cycle; one lease after it finds B1.
  frameFree: { leases: 1, acks: 2 },
  // The first lease takes K1, B1, D1; K1's and B1's more lease once more after D1: K2, B2.
  backlog: { leases: 2, acks: 5 },
  // The same: one cycle at a time, whatever a write takes.
  backlogSlow: { leases: 2, acks: 5 },
  // The e2e "before": B1 and D1, held past 60 s behind K1, are handed back (2 acks). The acks go out one at a time, so
  // D1's leaves as B1's answer arrives (20 ms later); the lease right after finds both not due (2 s backoff: empty).
  // B1's answer set the timer, its delay clamped to at least 2 000 ms (printAgentTimerDelayMs), so it fires no sooner
  // than D1 is due: its lease takes both. Then 3 printed acks.
  stuck: { leases: 2, acks: 5 },
  // The device line: J1's ack says more, the second lease takes J2.
  simple: { leases: 2, acks: 2 },
};
