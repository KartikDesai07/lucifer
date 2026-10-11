/**
 * Shared fixtures + helpers of the CB-7 S4 live leg (verify-reward-cards-live.ts): the dep builders that inject ONLY
 * the clock / env into the REAL scratch + wallet ports, and the barrier wrapper around the real scratch ports. Split
 * out only to keep both files under the size cap. (ops CLI support module, not app code.)
 */
import type { Types } from "mongoose";

import { DINER_CARDS_DEPS, type DinerCardsDeps } from "@/lib/reward-cards-read";
import { REWARD_SCRATCH_DEPS, type RewardScratchDeps } from "@/lib/reward-card-scratch";
import { SCRATCH_BLOCK_ENV_VAR } from "@pos/shared/reward-levels";
import { CLEAN_ENV } from "./reward-progress-live-kit";

export type Rec = Record<string, unknown>;

export const idOf = (id: Types.ObjectId): string => String(id);
export const asRec = (value: unknown): Rec => value as Rec;
export const BLOCKED_ENV = { [SCRATCH_BLOCK_ENV_VAR]: "true" } as unknown as NodeJS.ProcessEnv;
export const TN_GSTIN = "33ABCDE1234F1Z5";

// The REAL ports with only the instant (and, where a leg needs it, the environment) replaced.
export const scratchDepsAt = (at: Date, env: NodeJS.ProcessEnv = CLEAN_ENV): RewardScratchDeps => ({ ...REWARD_SCRATCH_DEPS, now: () => at, env });
export const walletDepsAt = (at: Date, env: NodeJS.ProcessEnv = CLEAN_ENV): DinerCardsDeps => ({ ...DINER_CARDS_DEPS, now: () => at, env });

export interface ScratchBarrier {
  deps: (at: Date) => RewardScratchDeps;
  events: string[];
  matched: number[];
  reads: () => number;
}

// n racers' FIRST readCard all wait for each other (every racer has read the card as "ready" before ANY racer's
// revealCard runs); later reads (the CAS losers' re-reads) pass straight through. Wraps the REAL ports: the read and
// the write still hit Mongo. `events` is the order: "read-arrived" x n, then the "reveal" calls.
export function scratchBarrier(n: number): ScratchBarrier {
  const events: string[] = [];
  const matched: number[] = [];
  let reads = 0;
  let waiting = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const deps = (at: Date): RewardScratchDeps => ({
    ...scratchDepsAt(at),
    readCard: async (customerId) => {
      reads += 1;
      const mine = reads;
      const value = await REWARD_SCRATCH_DEPS.readCard(customerId);
      if (mine <= n) {
        events.push("read-arrived");
        waiting += 1;
        if (waiting === n) release();
        await gate;
      }
      return value;
    },
    revealCard: async (filter, update) => {
      events.push("reveal");
      const res = await REWARD_SCRATCH_DEPS.revealCard(filter, update);
      matched.push(res.matchedCount);
      return res;
    },
  });
  return { deps, events, matched, reads: () => reads };
}
