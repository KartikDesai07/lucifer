import type { LeasedPrintJob, PrintAckData, PrintLeaseData } from "@pos/shared/print-agent-wire";

// Printing redesign, Phase 1 Session 1C (spec §9.1): the in-page print agent's shapes. Split out of
// print-agent.ts in Session 2B to keep that file near its ~300-line budget; print-agent.ts re-exports them.

export type PrintAgentResult = { ok: true } | { ok: false; error: unknown };

export interface PrintAgentAckBody {
  deviceId: string;
  epoch: number;
  outcome: "printed" | "failed";
  sent?: "no" | "maybe";
  permanent?: true;
  error?: string;
  /** Session 3B (spec §9.3): a network printer this device could not reach before any byte (PRINT_ACK_UNREACHABLE). */
  reason?: "unreachable";
}

export interface PendingPrintAck {
  id: string;
  epoch: number;
  at: number;
  /** A failed ack that got no answer (M4); absent: a "printed" ack. */
  fail?: PrintAgentAckBody;
}

export interface PrintAgentDeps {
  deviceId: string;
  /** Leases this device's own line and the printers named (Session 2E: those no refusal holds). */
  lease(printerIds: readonly string[]): Promise<PrintLeaseData>;
  ack(id: string, body: PrintAgentAckBody): Promise<PrintAckData>;
  /** Prints one leased job through the host bridge. Never rejects. */
  print(job: LeasedPrintJob): Promise<PrintAgentResult>;
  /** canPrintNow(): a printer here that can print right now. Session 2F1: or a printer this device prints that can. */
  printerReady(): boolean;
  /** Any value whose identity changes when this device's printer changes (its snapshot). */
  printerState(): unknown;
  /** Session 2E: the printers this device prints here (printers mode); absent: its own line only. */
  readyPrinters?(): readonly string[];
  /** Session 2E: the line a job's refusal holds: its printer, by id (the 2F1 review gate, M-1), else this device's own
   *  printer (""). */
  lineOf?(job: LeasedPrintJob): string;
  /** Session 3B (spec §9.3): the job's printer is a network printer this device prints (its refusal before any byte
   *  is acked "unreachable", so another device takes the printer over). Absent: none is. */
  networkPrinter?(job: LeasedPrintJob): boolean;
  readPending(): PendingPrintAck[];
  writePending(entries: PendingPrintAck[]): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface PrintAgent {
  setGate(gate: { enabled: boolean; busy: boolean }): void;
  /** A job may wait for this device (an answer, a frame, the pulse, the wake, a timer): lease now, or once
   *  the running cycle ends. The 2E review gate (M-1): a job's printer, when known; a printer this tab does not lease
   *  now (held by a refusal, or not printed here) is no reason to lease the others. */
  kick(printerId?: string): void;
  /** Session 2B: this device's state changed (its printer): lease now if idle, never queued behind a cycle. */
  nudge(): void;
  flushAcks(): Promise<void>;
  stop(): void;
  /** Session 2B: a job already leased to this tab (an answer carried it). Printed before any lease. */
  take(job: LeasedPrintJob): void;
  /** Session 2B: this tab drains, its printer can print now and no refusal holds it, so its requests may
   *  ask for their slips leased to it (directPrintTab). */
  directReady(): boolean;
  /** Session 2E: the printers this tab can print now: ready here and not held by a refusal of their own. */
  openPrinters(): string[];
}
