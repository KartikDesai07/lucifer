import { test } from "node:test";
import assert from "node:assert/strict";

import type { ISettings } from "@/models/Settings";
import {
  resolveRewardLevels,
  rewardLevelsChosen,
  rewardLevelsEarning,
  scratchCardsBlockedFor,
} from "@/lib/reward-levels-config";
import { SCRATCH_BLOCK_ENV_VAR } from "@pos/shared/reward-levels";

// CB-7 S1: the three predicates of plan section 2.11. Settings are plain objects cast to ISettings and the env is
// an INJECTED object - process.env is never read or mutated here, so a stray SCRATCH_CARDS_BLOCKED on the box
// cannot flip a result.

const BLOB = {
  v: 1,
  enabled: true,
  levels: [
    {
      size: 3,
      slots: [{ step: 3, scratchDays: 7, useDays: 14, options: [{ kind: "bill-percent", id: "a1", weight: 1, min: 5, max: 10 }] }],
    },
  ],
};
// Not parseable by the READ schema (a bad version) yet the owner still said enabled: true.
const UNREADABLE = { v: 99, enabled: true, levels: "garbage" };

const settingsOf = (o: Record<string, unknown>): ISettings => o as unknown as ISettings;
const ON = settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "27ABCDE1234F1Z5" });
// ProcessEnv demands NODE_ENV in Next's typings; the functions only ever read the one flag, so the cast is safe.
const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;
const NO_ENV = envOf({});

test("rewardLevelsChosen: raw enabled === true, even when the blob is otherwise unreadable", () => {
  assert.equal(rewardLevelsChosen(ON), true);
  assert.equal(resolveRewardLevels(settingsOf({ rewardLevels: UNREADABLE })), null, "landmark: that blob really is unreadable");
  assert.equal(rewardLevelsChosen(settingsOf({ rewardLevels: UNREADABLE })), true);
});

test("rewardLevelsChosen: false for null settings, an absent blob, enabled false/absent, and a non-object blob", () => {
  assert.equal(rewardLevelsChosen(null), false);
  assert.equal(rewardLevelsChosen(settingsOf({})), false);
  assert.equal(rewardLevelsChosen(settingsOf({ rewardLevels: { ...BLOB, enabled: false } })), false);
  assert.equal(rewardLevelsChosen(settingsOf({ rewardLevels: { v: 1, levels: [] } })), false);
  assert.equal(rewardLevelsChosen(settingsOf({ rewardLevels: "yes" })), false);
  assert.equal(rewardLevelsChosen(settingsOf({ rewardLevels: [true] })), false);
});

test("rewardLevelsChosen: a Tamil Nadu GSTIN or a blocking env never turns the owner's choice false", () => {
  const tn = settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "33ABCDE1234F1Z5" });
  assert.equal(scratchCardsBlockedFor(tn, NO_ENV), true, "landmark: it is blocked");
  assert.equal(rewardLevelsChosen(tn), true);
});

test("resolveRewardLevels: the parsed config for a readable blob, null for absent / unreadable / null settings", () => {
  assert.deepEqual(resolveRewardLevels(ON), BLOB);
  assert.equal(resolveRewardLevels(null), null);
  assert.equal(resolveRewardLevels(settingsOf({})), null);
  assert.equal(resolveRewardLevels(settingsOf({ rewardLevels: UNREADABLE })), null);
});

test("rewardLevelsEarning: true only when accounts on + chosen + readable + not blocked", () => {
  assert.equal(rewardLevelsEarning(ON, NO_ENV), true, "the one all-pass case");
});

test("rewardLevelsEarning: false when diner accounts are off or absent", () => {
  assert.equal(rewardLevelsEarning(settingsOf({ dinerAccountsEnabled: false, rewardLevels: BLOB }), NO_ENV), false);
  assert.equal(rewardLevelsEarning(settingsOf({ rewardLevels: BLOB }), NO_ENV), false);
  assert.equal(rewardLevelsEarning(null, NO_ENV), false);
});

test("rewardLevelsEarning: false when the blob is unreadable, absent, or not chosen", () => {
  assert.equal(rewardLevelsEarning(settingsOf({ dinerAccountsEnabled: true, rewardLevels: UNREADABLE }), NO_ENV), false);
  assert.equal(rewardLevelsEarning(settingsOf({ dinerAccountsEnabled: true }), NO_ENV), false);
  assert.equal(rewardLevelsEarning(settingsOf({ dinerAccountsEnabled: true, rewardLevels: { ...BLOB, enabled: false } }), NO_ENV), false);
});

test("rewardLevelsEarning: false when the env flag blocks, true again when it says off", () => {
  assert.equal(rewardLevelsEarning(ON, envOf({ [SCRATCH_BLOCK_ENV_VAR]: "true" })), false);
  assert.equal(rewardLevelsEarning(ON, envOf({ [SCRATCH_BLOCK_ENV_VAR]: "0" })), true);
});

test("rewardLevelsEarning: false for a GSTIN that starts 33, true for another state's", () => {
  assert.equal(rewardLevelsEarning(settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "33ABCDE1234F1Z5" }), NO_ENV), false);
  assert.equal(rewardLevelsEarning(settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "27ABCDE1234F1Z5" }), NO_ENV), true);
});

test("scratchCardsBlockedFor: env table spot-checks - true/yes/1 block, 0/false/off/blank/absent do not", () => {
  const plain = settingsOf({});
  for (const v of ["true", "yes", "1", "TN"]) assert.equal(scratchCardsBlockedFor(plain, envOf({ [SCRATCH_BLOCK_ENV_VAR]: v })), true, `"${v}" blocks`);
  for (const v of ["0", "false", "off", "no", "", "  "]) assert.equal(scratchCardsBlockedFor(plain, envOf({ [SCRATCH_BLOCK_ENV_VAR]: v })), false, `"${v}" allows`);
  assert.equal(scratchCardsBlockedFor(plain, NO_ENV), false);
  assert.equal(scratchCardsBlockedFor(null, NO_ENV), false, "null settings with no env: not blocked");
});

test("scratchCardsBlockedFor: the default env argument is process.env, which these tests never mutate", () => {
  // The signature default is the production path; passing nothing must agree with passing process.env.
  const plain = settingsOf({});
  assert.equal(scratchCardsBlockedFor(plain), scratchCardsBlockedFor(plain, process.env));
});
