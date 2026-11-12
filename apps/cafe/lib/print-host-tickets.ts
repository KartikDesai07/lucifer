import { PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { PrintWriteError, hostPrintFailureMessage } from "@/lib/print-write-outcome";

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
