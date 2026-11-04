// How often the staff pulse ticks (Printing Phase 5, spec 5.11). Pure: the provider passes what it knows. Quiet
// devices go calm to save the host's request budget; anything that could need a fast answer keeps the 20 s beat.

import { REFETCH_INTERVALS } from "@pos/shared/query";

/** A device that just made a slip watches for it for this long (the stuck-slip alarm rides the pulse). */
export const PULSE_OWN_SLIP_WINDOW_MS = 120_000;

export interface PulseCadenceInput {
  /** Realtime is proven to deliver, so the pulse is not the only way changes arrive. */
  realtimeTrusted: boolean;
  offline: boolean;
  outboxEntries: number;
  /** From the last pulse answer. */
  printAttention: number;
  printJobsForMe: number;
  openRequests: number;
  lastOwnSlipAt: number | null;
  nowMs: number;
}

export function pulseIntervalMs(input: PulseCadenceInput): number {
  const ownSlipRecent = input.lastOwnSlipAt !== null && input.nowMs - input.lastOwnSlipAt < PULSE_OWN_SLIP_WINDOW_MS;
  const lively =
    !input.realtimeTrusted || input.offline || input.outboxEntries > 0 || input.printAttention > 0 || input.printJobsForMe > 0 || input.openRequests > 0 || ownSlipRecent;
  return lively ? REFETCH_INTERVALS.POS_PULSE : REFETCH_INTERVALS.POS_PULSE_CALM;
}
