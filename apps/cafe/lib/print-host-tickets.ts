import { PRINT_HOST_PRINT_FAILED_MESSAGE, type SlipPrintTarget } from "@/lib/print-host-slips";
import { PrintWriteError, hostPrintFailureMessage } from "@/lib/print-write-outcome";
import { armLaneWrite, laneKeyOfTarget } from "@/lib/printer/lane-writes";

// Printing redesign Phase 6 (spec §9 rulings 10 and 12): a TICKET per slip instead of the outcomes FIFO
// (print-host-outcomes.ts). Slips are still drawn one at a time on one surface, but a slip's write can run
// on its printer's lane while the next slip draws, so results come back out of order: every caller hears
// its own slip's result. A ticket is waiting -> drawing (`dispatched`, right before the bridge arms the
// surface or the text write) -> finished, or drawing -> writing (`handOff`) -> finished. A slip never
// drawn is never "maybe" (withdraw / unmount answer it sent "no"); a slip drawn is waited for (ruling 12).
// Every `done` runs at most once and one that throws never stops the others. Pure: no React, no timer.

export type HostPrintResult = { ok: true; written?: number } | { ok: false; error: unknown };
export type HostPrintDone = (result: HostPrintResult) => void;

/** Sent "no": the slip never reached the surface before it was given up on. */
export const PRINT_HOST_NOT_DRAWN_MESSAGE = "waited too long to be drawn on this device";

/** An opaque handle to one slip's place in the bridge. */
export interface HostSlipTicket {
  readonly seq: number;
  readonly jobId: string | undefined;
}

export interface HostSlipTickets {
  /** A slip (or the test slip, `null`) joined the bridge's line. */
  add(done: HostPrintDone | null, jobId?: string): HostSlipTicket;
  /** The surface (or the text write) is about to draw this slip: waiting -> drawing. Ignored otherwise. */
  dispatched(ticket: HostSlipTicket): void;
  /** Drawing -> writing: run `write` `writes` times in order, then answer the caller and call `onEnd`.
   *  Throws for a ticket that is not drawing. The first write starts before this returns. */
  handOff(ticket: HostSlipTicket, write: () => Promise<void>, writes: number, onEnd: (ticket: HostSlipTicket, result: HostPrintResult) => void): void;
  /** True from `handOff` on, also after its writes ended (the surface's late settle must not be taken for a slip not handed off). */
  handedOff(ticket: HostSlipTicket): boolean;
  /** The surface's answer for a one-step slip: finishes a waiting or drawing ticket, ignored otherwise. */
  settle(ticket: HostSlipTicket, result: HostPrintResult): void;
  /** Finishes a waiting ticket sent "no"; returns whether it did. */
  withdraw(ticket: HostSlipTicket): boolean;
  /** The bridge went away: waiting -> "no", drawing -> "maybe"; writing tickets settle by themselves. */
  unmount(): { withdrawn: number; maybe: number };
  /** Tickets in the writing state. */
  writing(): number;
}

type State = "waiting" | "drawing" | "writing" | "finished";
interface Entry extends HostSlipTicket {
  state: State;
  done: HostPrintDone | null;
  handed: boolean;
}

export function createHostSlipTickets(): HostSlipTickets {
  let counter = 0;
  const live = new Set<Entry>();

  const entryOf = (ticket: HostSlipTicket): Entry => ticket as Entry;

  function finish(entry: Entry, result: HostPrintResult): void {
    entry.state = "finished";
    live.delete(entry);
    const done = entry.done;
    entry.done = null;
    if (done === null) return;
    try {
      done(result);
    } catch {
      // A throwing listener must not wedge the bridge.
    }
  }

  async function runWrites(entry: Entry, write: () => Promise<void>, writes: number, onEnd: (ticket: HostSlipTicket, result: HostPrintResult) => void): Promise<void> {
    let result: HostPrintResult = { ok: true, written: writes };
    for (let n = 1; n <= writes; n += 1) {
      try {
        await write();
      } catch (e) {
        const message = hostPrintFailureMessage(e);
        result = { ok: false, error: n === 1 ? new Error(message) : new PrintWriteError(message, "maybe") };
        break;
      }
    }
    finish(entry, result);
    try {
      onEnd(entry, result);
    } catch {
      // Never stops anything else.
    }
  }

  return {
    add(done, jobId) {
      counter += 1;
      const entry: Entry = { seq: counter, jobId, state: "waiting", done, handed: false };
      live.add(entry);
      return entry;
    },
    dispatched(ticket) {
      const entry = entryOf(ticket);
      if (entry.state === "waiting") entry.state = "drawing";
    },
    handOff(ticket, write, writes, onEnd) {
      const entry = entryOf(ticket);
      if (entry.state !== "drawing") throw new Error("print-host-tickets: handOff of a ticket that is not drawing");
      entry.state = "writing";
      entry.handed = true;
      void runWrites(entry, write, writes, onEnd);
    },
    handedOff(ticket) {
      return entryOf(ticket).handed;
    },
    settle(ticket, result) {
      const entry = entryOf(ticket);
      if (entry.state === "waiting" || entry.state === "drawing") finish(entry, result);
    },
    withdraw(ticket) {
      const entry = entryOf(ticket);
      if (entry.state !== "waiting") return false;
      finish(entry, { ok: false, error: new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no") });
      return true;
    },
    unmount() {
      let withdrawn = 0;
      let maybe = 0;
      for (const entry of [...live]) {
        if (entry.state === "waiting") {
          withdrawn += 1;
          finish(entry, { ok: false, error: new PrintWriteError(PRINT_HOST_NOT_DRAWN_MESSAGE, "no") });
        } else if (entry.state === "drawing") {
          maybe += 1;
          finish(entry, { ok: false, error: new Error(PRINT_HOST_PRINT_FAILED_MESSAGE) });
        }
      }
      return { withdrawn, maybe };
    },
    writing() {
      let n = 0;
      for (const entry of live) if (entry.state === "writing") n += 1;
      return n;
    },
  };
}

// ---- Phase 6 Task 4: the bridge's bookkeeping around its tickets (hooks/use-print-host-bridge.ts keeps the React wiring).

type WriteEnd = (ticket: HostSlipTicket, result: HostPrintResult) => void;

/** The bridge's waiting attestation test slip (PH-7): resolved with trigger -> onAfterPrint milliseconds. */
export interface HostTestSlipWaiter {
  resolve: (dtMs: number) => void;
  reject: (err: Error) => void;
  startedAt: number;
}

/** The surface's settle of the slip on it (spec §9 ruling 10): a ticket handed off to its lane is answered by its write,
 *  so the surface only frees (true); any other is settled with the surface's result, as before Phase 6 (false). */
export function settleOrRelease(tickets: HostSlipTickets, ticket: HostSlipTicket | null, result: HostPrintResult): boolean {
  if (ticket === null) return false;
  if (tickets.handedOff(ticket)) return true;
  tickets.settle(ticket, result);
  return false;
}

/** The surface is about to draw this ticket's slip (spec §9 rulings 8, 9): waiting -> drawing, and a slip that takes two
 *  steps (for one of the POS app's printers or a Windows app network printer, on any surface but `test`) has that
 *  printer's next write handed to the ticket, written `writes` times (absent: once). Returns the disarm (none: a no-op). */
export function dispatchSlip(tickets: HostSlipTickets, ticket: HostSlipTicket | null, slip: { surface: string; target?: SlipPrintTarget; writes?: number } | null, onEnd: WriteEnd): () => void {
  if (ticket === null) return () => undefined;
  tickets.dispatched(ticket);
  const lane = slip === null || slip.surface === "test" ? null : laneKeyOfTarget(slip.target);
  const writes = slip?.writes ?? 1;
  return lane === null ? () => undefined : armLaneWrite(lane, (write) => tickets.handOff(ticket, write, writes, onEnd));
}

/** Withdraw (spec §9 ruling 12): a slip still waiting to be drawn is answered sent "no": one in `queue` is taken off it
 *  ("queue"); the one on the surface (`current`) only while its dispatch still waits ("current": the bridge then puts the
 *  next on the surface). A slip drawn is waited for (null). */
export function withdrawSlip(tickets: HostSlipTickets, queue: Array<{ ticket: HostSlipTicket }>, current: HostSlipTicket | null, ticket: HostSlipTicket): "queue" | "current" | null {
  const at = queue.findIndex((entry) => entry.ticket === ticket);
  if (at < 0 && current !== ticket) return null;
  if (at >= 0) queue.splice(at, 1);
  if (!tickets.withdraw(ticket)) return null;
  return at >= 0 ? "queue" : "current";
}

/** A write on its lane ended (spec §9 ruling 10; its ticket has told its caller): a failure is said once, with its own
 *  slip's job, in the sentence its ticket carries: hostPrintFailureMessage applied once, as the surface's settle does
 *  (fix round 1, m-3: never twice; the Windows app's unwrapped sentence would not survive a second mapping). Then `after`. */
export function laneWriteEnd(say: (failure: string, jobId: string | undefined) => void, after: () => void): WriteEnd {
  return (ticket, result) => {
    if (!result.ok) say(result.error instanceof Error ? result.error.message : hostPrintFailureMessage(result.error), ticket.jobId);
    after();
  };
}
