import type { DinerLevelProgress } from "@pos/shared/public-diner-cards";

// CB-7 S4 — where one ladder box stands for this diner. PURE.
//   next    the box the engine says the NEXT card comes from (progress.nextBox, level + step). It wins over "done":
//           a repeat of the last level (F5) can put the next box at a step the counter already passed.
//   done    every box of an earlier level, and boxes of the current level up to the number filled.
//   locked  everything else (a later box is NOT "next" just because it is the first one left — boxes sit on any step).
//   plain   the cafe is not earning (no progress): rows without a state mark.
export type BoxState = "done" | "next" | "locked" | "plain";

export function boxStateOf(level: number, step: number, progress: DinerLevelProgress | null): BoxState {
  if (progress === null) return "plain";
  if (progress.nextBox !== null && progress.nextBox.level === level && progress.nextBox.step === step) return "next";
  if (level < progress.level) return "done";
  if (level === progress.level && step <= progress.filled) return "done";
  return "locked";
}
