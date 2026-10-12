import type { ISettings } from "@/models/Settings";
import { dinerAccountsOn } from "@/lib/diner-route-guard";
import { SCRATCH_BLOCK_ENV_VAR, type RewardLevelsConfig } from "@pos/shared/reward-levels";
import { gstinBlocksScratch, scratchCardsBlocked, scratchEnvBlocks } from "@pos/shared/reward-levels-engine";
import { BLOCKED_PLATFORM, BLOCKED_TN } from "@/lib/reward-levels-copy";
import { parseStoredRewardLevels, rewardLevelsChosenRaw } from "@pos/shared/schemas/reward-levels-read.schema";

// CB-7 S1 — the ONE place the stored reward-levels blob is read, and the three-predicate split of plan §2.11
// (never one overloaded "rewardLevelsOn"). SERVER-ONLY: scratchCardsBlockedFor reads process.env, and this
// repo has no `server-only` package, so a source pin (reward-paths.test.ts) asserts no "use client" file imports
// this module — clients get server-computed booleans (S3's settings GET, S4's public-diner-config), never this.
//
// NOTHING CALLS THESE IN S1, ON PURPOSE: the feature stays dormant. S2 wires progress/issue, S3 the editor, S4 the
// diner surface; until then `rewardLevels` is absent everywhere and a live cafe is unchanged.

// The validated config, or null when the blob is absent or unreadable (the READ schema is the validator).
export function resolveRewardLevels(settings: ISettings | null): RewardLevelsConfig | null {
  return parseStoredRewardLevels(settings?.rewardLevels);
}

// The platform owner's switch (env, authoritative) OR a Tamil Nadu GSTIN prefix (secondary catch). The env is a
// parameter so tests inject an object instead of mutating process.env.
export function scratchCardsBlockedFor(settings: ISettings | null, env: NodeJS.ProcessEnv = process.env): boolean {
  return scratchCardsBlocked({ envFlag: env[SCRATCH_BLOCK_ENV_VAR], gstNumber: settings?.gstNumber });
}

// The OWNER's mode: the stored blob says enabled === true, read raw and independent of the full parse. It stops
// stamp grants (S2) and picks the diner surface. A block, an unreadable blob or a rollback must NOT turn it
// false — stamps never come back on by themselves (no automatic setting flips).
export function rewardLevelsChosen(settings: ISettings | null): boolean {
  return rewardLevelsChosenRaw(settings?.rewardLevels);
}

// Whether the owner ever saved a levels blob (any object: readable or not, enabled or not). It decides only whether the
// diner's wallet is worth reading (S4 cardsOn) - the cards a diner already holds outlive a switch-off. Never a
// substitute for the owner's mode (rewardLevelsChosen) nor for "does it run" (rewardLevelsEarning).
export function rewardLevelsStored(settings: ISettings | null): boolean {
  const raw: unknown = settings?.rewardLevels;
  return raw !== null && typeof raw === "object" && !Array.isArray(raw);
}

// Whether progress / issue / scratch actually run: accounts on, the owner chose levels, the blob parses, and
// nothing blocks scratch cards. Using a revealed card stays gated by accounts alone (S5), not by this.
export function rewardLevelsEarning(settings: ISettings | null, env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    dinerAccountsOn(settings) &&
    rewardLevelsChosen(settings) &&
    resolveRewardLevels(settings) !== null &&
    !scratchCardsBlockedFor(settings, env)
  );
}

// CB-7 S5 unlock: the PUT refuses an OFF -> ON flip while scratch cards are blocked for this cafe (the Tamil Nadu
// guard of §2.11: the platform env flag OR a GSTIN state code the owner cannot flip). Returns the plain-English
// refusal, or null to let the write through. ONLY the flip is refused: turning OFF, clearing, re-saving a blob that
// is already on (an existing state is never locked out) and saving a draft all stay allowed. `stored` is the blob
// as saved BEFORE this PUT; `gstNumber` is the GSTIN the cafe will have AFTER it (body value, else the stored one).
export function rewardLevelsSwitchOnRefusal(
  incoming: unknown,
  stored: unknown,
  block: { envFlag: string | undefined | null; gstNumber: string | undefined | null },
): string | null {
  if (!rewardLevelsChosenRaw(incoming) || rewardLevelsChosenRaw(stored)) return null;
  if (gstinBlocksScratch(block.gstNumber)) return BLOCKED_TN;
  if (scratchEnvBlocks(block.envFlag)) return BLOCKED_PLATFORM;
  return null;
}
