import type { LeasedPrintJob, PrintAckData } from "@pos/shared/print-agent-wire";
import { ApiError } from "@/lib/api-client";
import { createPrintAgent } from "@/lib/print-agent";
import { PRINT_DEVICE_LINE } from "@/lib/print-agent-holds";
import type { PendingPrintAck, PrintAgent, PrintAgentAckBody, PrintAgentDeps, PrintAgentResult } from "@/lib/print-agent-types";

// Test support (NOT app code: no app file imports it). Printing Phase 6 Task 5 (spec §9 rulings 14-21, 25): the rig the
// rule tests drive the agent per line with (lib/print-lines-rules.test.ts, lib/print-lines-rules-2.test.ts). Three
// printer lines K, B, D; every print hangs until the test finishes it, and the test plays the surface (drawn(): it drew
// the slip it took and freed, an opening). lib/print-lines-world.ts drives whole scenarios.

export const RIG_T0 = 1_800_000_000_000;

/** A job on its line (by default the id's first letter; PRINT_DEVICE_LINE: a device-line job). */
export function job(id: string, line = id.slice(0, 1), epoch = 1): LeasedPrintJob {
  return {
    id,
    epoch,
    kind: "kot",
    label: `KOT ${id}`,
    createdAt: new Date(RIG_T0).toISOString(),
    payload: { kind: "eod", dateKey: "2026-11-12", dateLabel: "12 Nov" } as unknown as LeasedPrintJob["payload"],
    labels: [],
    copyIndex: 0,
    attempt: epoch,
    ...(line === PRINT_DEVICE_LINE ? {} : { printerId: line }),
  };
}
export const printed = (more: boolean): PrintAckData => ({ applied: true, status: "printed", nextAttemptAt: null, more });
export const queuedAt = (ms: number): PrintAckData => ({ applied: true, status: "queued", nextAttemptAt: new Date(ms).toISOString() });
/** Every microtask runs out first. */
export const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

export interface RigRecord {
  now: number;
  seq: number;
  /** Every ack fails on the network (no answer). */
  down: boolean;
  /** Each lease's printer ids. */
  asked: string[][];
  /** Each lease's jobs, in turn (none left: an empty answer). */
  leases: LeasedPrintJob[][];
  /** `${id}:${outcome}[:${sent}]` per ack sent, and its body. */
  acks: string[];
  bodies: PrintAgentAckBody[];
  /** The printed acks whose entry was in the pending store when they went out. */
  kept: string[];
  /** One answer per job id (default: printed more:false, or failed more:false); a promise hangs it. */
  answers: Map<string, PrintAckData | Promise<PrintAckData>>;
  /** The prints in flight, by job id. */
  open: Map<string, (result: PrintAgentResult) => void>;
  prints: string[];
  pending: PendingPrintAck[];
  timers: Array<{ at: number; fn: () => void; id: number }>;
}

export interface Rig {
  r: RigRecord;
  deps: PrintAgentDeps;
  agent: PrintAgent;
  gate(busy: boolean): void;
  /** The page's mount (its own look at the lines), then a clean record. */
  start(): Promise<void>;
  /** The surface drew the slip it took and freed: an opening. */
  drawn(): Promise<void>;
  /** The print of this job ends (default: on paper). */
  finish(id: string, result?: PrintAgentResult): Promise<void>;
  advance(ms: number): Promise<void>;
}

export function rig(): Rig {
  const r: RigRecord = {
    now: RIG_T0,
    seq: 0,
    down: false,
    asked: [],
    leases: [],
    acks: [],
    bodies: [],
    kept: [],
    answers: new Map(),
    open: new Map(),
    prints: [],
    pending: [],
    timers: [],
  };
  const deps: PrintAgentDeps = {
    deviceId: "dev-r",
    lease: async (ids) => {
      r.asked.push([...ids]);
      return { jobs: r.leases.shift() ?? [], retryAt: null };
    },
    ack: async (id, body) => {
      r.acks.push(`${id}:${body.outcome}${body.sent === undefined ? "" : `:${body.sent}`}`);
      r.bodies.push(body);
      if (body.outcome === "printed" && r.pending.some((e) => e.id === id)) r.kept.push(id);
      if (r.down) throw new ApiError("offline", "network", null);
      const answer = r.answers.get(id);
      r.answers.delete(id);
      return answer ?? (body.outcome === "printed" ? printed(false) : { applied: true, status: "failed", nextAttemptAt: null, more: false });
    },
    print: (j) =>
      new Promise((resolve) => {
        r.prints.push(j.id);
        r.open.set(j.id, resolve);
      }),
    printerReady: () => true,
    printerState: () => r,
    readyPrinters: () => ["K", "B", "D"],
    lineOf: (j) => j.printerId ?? PRINT_DEVICE_LINE,
    readPending: () => [...r.pending],
    writePending: (entries) => void (r.pending = [...entries]),
    now: () => r.now,
    setTimer: (fn, ms) => {
      r.seq += 1;
      r.timers.push({ at: r.now + ms, fn, id: r.seq });
      return r.seq;
    },
    clearTimer: (handle) => void (r.timers = r.timers.filter((t) => t.id !== handle)),
  };
  const agent = createPrintAgent(deps);
  const gate = (busy: boolean): void => agent.setGate({ enabled: true, busy });
  return {
    r,
    deps,
    agent,
    gate,
    async start() {
      gate(false);
      await settle();
      r.asked = [];
    },
    async drawn() {
      gate(true);
      gate(false);
      await settle();
    },
    async finish(id, result = { ok: true }) {
      const done = r.open.get(id);
      if (done === undefined) throw new Error(`${id} is not printing (printing: ${[...r.open.keys()].join(", ")})`);
      r.open.delete(id);
      done(result);
      await settle();
    },
    async advance(ms) {
      const end = r.now + ms;
      for (;;) {
        r.timers.sort((a, b) => a.at - b.at);
        const next = r.timers[0];
        if (next === undefined || next.at > end) break;
        r.timers.shift();
        r.now = next.at;
        next.fn();
        await settle();
      }
      r.now = end;
    },
  };
}
