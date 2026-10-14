import { test } from "node:test";
import assert from "node:assert/strict";

import { rewardCampaignWriteSchema } from "@pos/shared/schemas/reward-campaign.schema";
import {
  CAMPAIGN_BOX_LEVEL,
  CAMPAIGN_BOX_STEP,
  campaignDraftOf,
  campaignProblems,
  campaignSubmit,
  campaignWriteBody,
  editBox,
  starterCampaignDraft,
  type CampaignDraft,
} from "./reward-campaign-form";
import { REWARD_SCRATCH_DAYS_DEFAULT, REWARD_USE_DAYS_DEFAULT, replaceOption, withOption, newOption } from "./reward-levels-edit";
import { fieldProblem } from "./reward-levels-form";

// CB-7 S6 session 3 (E2) — the festival form's pure side: draft <-> body, the starter, and the write gate's problems in
// the (level, step, option, field) shape the settings option fields read.

const TODAY = "2026-10-14";
const OID = "0123456789abcdef01234567";
const OID2 = "0123456789abcdef01234568";

const valid = (over: Partial<CampaignDraft> = {}): CampaignDraft => ({ ...starterCampaignDraft(TODAY), name: "Diwali treat", ...over });

test("the starter is valid once it has a name: everyone, today only, one 10% option, the settings box's day defaults", () => {
  const draft = starterCampaignDraft(TODAY);
  assert.equal(draft.audience, "everyone");
  assert.equal(draft.startDay, TODAY);
  assert.equal(draft.endDay, TODAY);
  assert.equal(draft.maxCards, undefined);
  assert.equal(draft.box.scratchDays, REWARD_SCRATCH_DAYS_DEFAULT);
  assert.equal(draft.box.useDays, REWARD_USE_DAYS_DEFAULT);
  assert.deepEqual(draft.box.options.map((o) => [o.id, o.kind]), [["o1", "bill-percent"]]);
  assert.ok(!("step" in draft.box), "the box carries no step");
  assert.deepEqual(campaignProblems(draft).fields, { name: "Give the campaign a name" }, "only the name is missing");
  assert.equal(campaignProblems(valid()).sentences.length, 0);
});

test("round trip: draft -> body -> draft, picked and everyone, with and without a card limit", () => {
  const picked = valid({ audience: "picked", customerIds: [OID, OID2], maxCards: 50, startDay: "2026-11-01", endDay: "2026-11-05" });
  assert.deepEqual(campaignDraftOf(campaignWriteBody(picked)), picked);
  const everyone = valid();
  const body = campaignWriteBody(everyone);
  assert.deepEqual(campaignDraftOf(body), everyone);
  assert.ok(!("maxCards" in body), "a blank limit is left OUT of the body, never sent as undefined/0");
  assert.deepEqual(body.customerIds, []);
  assert.equal(rewardCampaignWriteSchema.safeParse(body).success, true, "the body is what the server's gate accepts");
});

test("switching to everyone drops a picked list from the body", () => {
  assert.deepEqual(campaignWriteBody(valid({ audience: "everyone", customerIds: [OID] })).customerIds, []);
  assert.deepEqual(campaignWriteBody(valid({ audience: "picked", customerIds: [OID] })).customerIds, [OID]);
});

test("submit: a valid draft goes out as the schema's output (name trimmed); an invalid one never does", () => {
  const ok = campaignSubmit(valid({ name: "  Diwali treat  " }));
  assert.ok(ok.ok && ok.body.name === "Diwali treat");
  const bad = campaignSubmit(valid({ name: "   " }));
  assert.ok(!bad.ok && bad.problems.fields.name === "Give the campaign a name");
});

test("a name / date / audience / limit error lands on its own field in plain words", () => {
  const p = campaignProblems(valid({ name: "", startDay: "2026-10-20", endDay: "2026-10-14", audience: "picked", customerIds: [], maxCards: 0 }));
  assert.equal(p.fields.name, "Give the campaign a name");
  assert.equal(p.fields.endDay, "The last day can't be before the first day");
  assert.equal(p.fields.customerIds, "Pick at least one customer");
  assert.equal(p.fields.maxCards, "The number of cards must be at least 1");
  assert.equal(p.box.length, 0, "no box problem for a valid box");
  const blank = campaignProblems(valid({ startDay: "" }));
  assert.equal(blank.fields.startDay, "Pick a date");
});

test("the body's own drop of the list means an everyone draft never trips the list rule", () => {
  assert.equal(campaignProblems(valid({ audience: "everyone", customerIds: [OID] })).fields.customerIds, undefined);
});

test("an option error lands on the option, at the fixed sentinel level and step", () => {
  const base = valid();
  const first = base.box.options[0];
  assert.ok(first !== undefined && first.kind === "bill-percent");
  const draft = editBox(base, (s) => replaceOption(s, first.id, { ...first, min: 30, max: 10 }));
  const p = campaignProblems(draft);
  assert.deepEqual(p.box.map((b) => [b.level, b.step, b.optionId, b.field]), [[CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, "o1", "max"]]);
  assert.equal(fieldProblem(p.box, CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, "o1", "max"), "The highest value must not be below the lowest");
  assert.deepEqual(p.fields, {}, "nothing leaks onto a campaign field");
  assert.equal(p.sentences[0], "The highest value must not be below the lowest");
});

test("a picker option left empty is a plain sentence, not Zod's own words", () => {
  const draft = editBox(valid(), (s) => withOption(s, newOption("free-item", "o2")));
  const p = campaignProblems(draft);
  const hit = p.box.find((b) => b.optionId === "o2" && (b.field === "productId" || b.field === "productName"));
  assert.ok(hit, "the empty item pick is marked on its option");
  assert.doesNotMatch(hit.message, /^(Required$|Expected |Invalid )/);
});

test("a TTL error lands on the box's own field (no option), a blank one reads as a whole-number sentence", () => {
  const p = campaignProblems(valid({ box: { ...valid().box, scratchDays: 0, useDays: Number.NaN } }));
  assert.equal(fieldProblem(p.box, CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, null, "scratchDays"), "The days to scratch must be at least 1");
  assert.equal(fieldProblem(p.box, CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, null, "useDays"), "The days to use must be a whole number");
  assert.deepEqual(p.fields, {});
});

test("a box of only 'No reward' options marks the box's options field, not an option", () => {
  const draft = editBox(valid(), (s) => ({ ...s, options: [newOption("none", "o1")] }));
  const p = campaignProblems(draft);
  assert.equal(fieldProblem(p.box, CAMPAIGN_BOX_LEVEL, CAMPAIGN_BOX_STEP, null, "options"), "Add at least one real reward to this box");
});

test("editBox keeps the box step-free and leaves the rest of the draft alone", () => {
  const base = valid({ name: "X", audience: "picked", customerIds: [OID] });
  const next = editBox(base, (s) => ({ ...s, scratchDays: 3 }));
  assert.equal(next.box.scratchDays, 3);
  assert.ok(!("step" in next.box));
  assert.deepEqual({ ...next, box: base.box }, base);
});
