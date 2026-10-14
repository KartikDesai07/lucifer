import { test } from "node:test";
import assert from "node:assert/strict";

import type { RewardCampaignDto } from "@pos/shared/reward-campaigns";
import { CAMPAIGNS_NEED_LEVELS, campaignWindow } from "@pos/shared/reward-campaigns";
import { BLOCKED_PLATFORM, BLOCKED_TN, SWITCH_NEEDS_SIGN_IN } from "./reward-levels-copy";
import {
  campaignDatesText,
  cardsGivenText,
  customerLabel,
  festivalNotice,
  mobileTail,
  notEndedCount,
  pickedCountText,
} from "./festival-cards-view";

// CB-7 S6 session 3 (E2) — the festival screen's plain-English wording.

const NOW = Date.parse("2026-10-14T06:30:00Z"); // 12:00 IST on 14 Oct 2026
const win = (a: string, b: string): { startsAt: number; endsAt: number } => {
  const w = campaignWindow(a, b);
  return { startsAt: w.startsAt.getTime(), endsAt: w.endsAt.getTime() };
};
const dto = (a: string, b: string, over: Partial<RewardCampaignDto> = {}): RewardCampaignDto => ({
  id: "c1", name: "N", audience: "everyone", customers: [], maxCards: null, issued: 0, endedEarly: false, createdAt: NOW,
  box: { scratchDays: 7, useDays: 30, options: [] }, ...win(a, b), ...over,
});

test("dates read as IST days: a range, a single day, and a year only when it is not this year", () => {
  const w = win("2026-10-14", "2026-10-20");
  assert.equal(campaignDatesText(w.startsAt, w.endsAt, NOW), "14 Oct – 20 Oct");
  const one = win("2026-10-09", "2026-10-09");
  assert.equal(campaignDatesText(one.startsAt, one.endsAt, NOW), "9 Oct");
  const old = win("2025-12-30", "2026-01-02");
  assert.equal(campaignDatesText(old.startsAt, old.endsAt, NOW), "30 Dec 2025 – 2 Jan 2026");
  const last = win("2025-11-01", "2025-11-03");
  assert.equal(campaignDatesText(last.startsAt, last.endsAt, NOW), "1 Nov 2025 – 3 Nov 2025");
});

// Review lens A LOW-3: "End now" on a campaign that had not started sets endsAt (now) BEFORE startsAt; the row must not read
// backwards ("20 Oct – 14 Oct").
test("a campaign ended before its first day says so instead of reading its dates backwards", () => {
  const planned = win("2026-10-20", "2026-10-25");
  assert.equal(campaignDatesText(planned.startsAt, NOW, NOW), "Ended before its first day (20 Oct)");
  // Landmark: ended early AFTER it started keeps the plain range (first day to the day it ended).
  const running = win("2026-10-10", "2026-10-25");
  assert.equal(campaignDatesText(running.startsAt, NOW, NOW), "10 Oct – 14 Oct");
});

test("the last day's 23:59 IST still reads as that day (not the next UTC day)", () => {
  const w = win("2026-10-14", "2026-10-14");
  assert.equal(campaignDatesText(w.startsAt, w.endsAt, NOW), "14 Oct");
});

test("cards given: with and without a limit, singular and plural", () => {
  assert.equal(cardsGivenText(12, 100), "12 of 100 cards given");
  assert.equal(cardsGivenText(1, 1), "1 of 1 card given");
  assert.equal(cardsGivenText(0, null), "0 cards given");
  assert.equal(cardsGivenText(1, null), "1 card given");
  assert.equal(pickedCountText(1), "1 customer");
  assert.equal(pickedCountText(3), "3 customers");
});

test("the not-ended count (what the create limit counts) skips an ended campaign", () => {
  const rows = [dto("2026-10-14", "2026-10-20"), dto("2026-11-01", "2026-11-02"), dto("2026-09-01", "2026-09-02"), dto("2026-10-14", "2026-10-30", { endsAt: NOW - 1 })];
  assert.equal(notEndedCount(rows, NOW), 2);
  assert.equal(notEndedCount([], NOW), 0);
});

test("a picker label shows the name and at most the last 4 digits, never the whole number", () => {
  assert.equal(mobileTail("98765 43210"), "3210");
  assert.equal(mobileTail("+91-98765-43210"), "3210");
  assert.equal(mobileTail("12"), "");
  const label = customerLabel({ name: "Asha", mobile: "9876543210" });
  assert.equal(label, "Asha · ends 3210");
  assert.ok(!label.includes("98765"));
  assert.equal(customerLabel({ name: "Asha", mobile: "" }), "Asha");
});

// Review lens A LOW-2: cards are given only while Reward levels are EARNING (rewardLevelsEarning = switched on AND not
// blocked), so the owner's notice must cover the Tamil Nadu GSTIN and the platform switch too, not only "switched off".
test("the owner's notice: blocked (Tamil Nadu GSTIN, then the platform switch) wins over off; nothing while unknown or earning", () => {
  const TN = "33ABCDE1234F1Z5";
  const MH = "27ABCDE1234F1Z5";
  assert.equal(festivalNotice({ accountsOn: true, levelsOn: true, gstNumber: TN, scratchBlocked: false }), BLOCKED_TN);
  assert.equal(festivalNotice({ accountsOn: true, levelsOn: false, gstNumber: TN, scratchBlocked: undefined }), BLOCKED_TN);
  assert.equal(festivalNotice({ accountsOn: true, levelsOn: true, gstNumber: MH, scratchBlocked: true }), BLOCKED_PLATFORM);
  assert.equal(festivalNotice({ accountsOn: true, levelsOn: false, gstNumber: MH, scratchBlocked: false }), CAMPAIGNS_NEED_LEVELS);
  // Landmarks: earning says nothing, and an unknown block state (still loading / failed) is never claimed.
  assert.equal(festivalNotice({ accountsOn: true, levelsOn: true, gstNumber: MH, scratchBlocked: false }), null);
  assert.equal(festivalNotice({ accountsOn: true, levelsOn: true, gstNumber: undefined, scratchBlocked: undefined }), null);
});

// Fix-round review LOW: rewardLevelsEarning also needs customer accounts on (the levels blob may still say enabled after
// the owner turns sign-in off), so the notice says so - after a block, which no switch can lift.
test("the owner's notice: customer sign-in off says so, even while the stored levels still read enabled", () => {
  const MH = "27ABCDE1234F1Z5";
  assert.equal(festivalNotice({ accountsOn: false, levelsOn: true, gstNumber: MH, scratchBlocked: false }), SWITCH_NEEDS_SIGN_IN);
  assert.equal(festivalNotice({ accountsOn: false, levelsOn: false, gstNumber: MH, scratchBlocked: false }), SWITCH_NEEDS_SIGN_IN);
  assert.equal(festivalNotice({ accountsOn: false, levelsOn: true, gstNumber: "33ABCDE1234F1Z5", scratchBlocked: false }), BLOCKED_TN);
});
