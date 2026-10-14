// CB-7 S6 session 3 (E2) — the plain-English wording of the festival-cards screen: dates, audience, cards given, and the
// customer picker's one-line labels. The shared contract (@pos/shared/reward-campaigns) owns the status / audience
// words and the page intro; this file only adds the screen's own sentences. PURE, client-safe.

import {
  CAMPAIGN_CUSTOMERS_MAX,
  CAMPAIGN_MAX_CARDS_MAX,
  CAMPAIGN_MAX_CARDS_MIN,
  CAMPAIGNS_ACTIVE_MAX,
  CAMPAIGNS_NEED_LEVELS,
  campaignStatusAt,
  type RewardCampaignDto,
} from "@pos/shared/reward-campaigns";
import { gstinBlocksScratch } from "@pos/shared/reward-levels-engine";
import { cafeDateString } from "@pos/shared/utils";
import { BLOCKED_PLATFORM, BLOCKED_TN, SWITCH_NEEDS_SIGN_IN } from "@/lib/reward-levels-copy";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const YMD_YEAR_END = 4;
const YMD_MONTH_START = 5;
const YMD_MONTH_END = 7;
const YMD_DAY_START = 8;
const MOBILE_TAIL_DIGITS = 4;

// ── Screen copy ──────────────────────────────────────────────────────────────

export const NEW_CAMPAIGN_LABEL = "New campaign";
export const NEW_CAMPAIGN_TITLE = "New festival campaign";
export const NEW_CAMPAIGN_DESCRIPTION = "One scratch card for each customer, during the dates you pick.";
export const LIMIT_REACHED_NOTE = `You already have ${CAMPAIGNS_ACTIVE_MAX} campaigns planned or running. End one to start another.`;
export const EMPTY_TITLE = "No festival campaigns yet";
export const EMPTY_DESCRIPTION = "Start one for Diwali, a birthday week or any special day. Customers get their card the next time they open their rewards.";
export const LOAD_FAILED = "Could not load your festival campaigns. Check the internet connection and try again.";
export const END_NOW_LABEL = "End now";
export const END_CONFIRM_TITLE = "End this campaign now?";
export const END_CONFIRM_DESCRIPTION = "No new cards will be given. Cards customers already have stay as they are.";
export const CREATED_TOAST = "Festival campaign created";
export const ENDED_TOAST = "Festival campaign ended";
export const CREATE_FAILED = "Could not create the campaign";
export const END_FAILED = "Could not end the campaign";
export const BOX_SECTION_TITLE = "The card customers get";
export const BOX_SECTION_HINT = "With more than one reward, each customer gets one of them by chance.";
export const NAME_HINT = "Customers see this name on their card.";
export const MAX_CARDS_HINT = `Optional. Stops after this many customers have a card (${CAMPAIGN_MAX_CARDS_MIN} to ${CAMPAIGN_MAX_CARDS_MAX}). Leave blank for no limit.`;
export const PICK_SEARCH_PLACEHOLDER = "Search by name or mobile";
export const PICK_NO_MATCH = "No customer matches that search.";
export const PICK_NONE_YET = "You have no customers yet. Add some on the Customers page first.";
export const PICK_CAP_NOTE = `You can pick up to ${CAMPAIGN_CUSTOMERS_MAX} customers.`;

// ── Dates ────────────────────────────────────────────────────────────────────

// "2026-10-14" -> "14 Oct" (no leading zero), or "14 Oct 2025" when withYear.
function dayLabel(ymd: string, withYear: boolean): string {
  const month = MONTHS[Number(ymd.slice(YMD_MONTH_START, YMD_MONTH_END)) - 1] ?? "";
  const label = `${Number(ymd.slice(YMD_DAY_START))} ${month}`;
  return withYear ? `${label} ${ymd.slice(0, YMD_YEAR_END)}` : label;
}

/**
 * "14 Oct - 20 Oct" (IST days). One day reads "14 Oct". A year shows only when it is not this year. "End now" on a campaign
 * that had not started leaves endsAt before startsAt - that reads "Ended before its first day (20 Oct)", never backwards.
 */
export function campaignDatesText(startsAt: number, endsAt: number, nowMs: number): string {
  const start = cafeDateString(new Date(startsAt));
  const end = cafeDateString(new Date(endsAt));
  const thisYear = cafeDateString(new Date(nowMs)).slice(0, YMD_YEAR_END);
  const withYear = start.slice(0, YMD_YEAR_END) !== thisYear || end.slice(0, YMD_YEAR_END) !== thisYear;
  if (endsAt < startsAt) return `Ended before its first day (${dayLabel(start, withYear)})`;
  return start === end ? dayLabel(start, withYear) : `${dayLabel(start, withYear)} – ${dayLabel(end, withYear)}`;
}

// ── The list rows ────────────────────────────────────────────────────────────

/** "12 of 100 cards given", or "12 cards given" with no limit. */
export function cardsGivenText(issued: number, maxCards: number | null): string {
  const noun = (n: number): string => (n === 1 ? "card" : "cards");
  return maxCards === null ? `${issued} ${noun(issued)} given` : `${issued} of ${maxCards} ${noun(maxCards)} given`;
}

/** "3 customers" / "1 customer" for a picked list. */
export function pickedCountText(count: number): string {
  return `${count} ${count === 1 ? "customer" : "customers"}`;
}

/** Campaigns that are still planned or running — the ones the create route counts toward its limit. */
export function notEndedCount(campaigns: readonly RewardCampaignDto[], nowMs: number): number {
  return campaigns.filter((c) => campaignStatusAt(c, nowMs) !== "ended").length;
}

// ── The customer picker ──────────────────────────────────────────────────────

/** The last 4 digits of a mobile number, for telling two customers with the same name apart ("" when shorter). */
export function mobileTail(mobile: string): string {
  const digits = mobile.replace(/\D/g, "");
  return digits.length >= MOBILE_TAIL_DIGITS ? digits.slice(-MOBILE_TAIL_DIGITS) : "";
}

/** "Asha · ends 4821" — a name and at most the last 4 digits, never the whole number. */
export function customerLabel(customer: { name: string; mobile: string }): string {
  const tail = mobileTail(customer.mobile);
  return tail === "" ? customer.name : `${customer.name} · ends ${tail}`;
}

// ── The "no cards are given right now" notice ────────────────────────────────

/**
 * Festival cards are given only while Reward levels are EARNING (rewardLevelsEarning: customer sign-in on, levels switched
 * on AND not blocked — fork O4), so the notice names the block first (no switch lifts it), then sign-in off (the stored
 * levels may still read enabled), then levels off. `scratchBlocked` is undefined while the platform answer loads or
 * fails: never claimed. Null = cards are being given.
 */
export function festivalNotice(input: {
  accountsOn: boolean;
  levelsOn: boolean;
  gstNumber: string | undefined;
  scratchBlocked: boolean | undefined;
}): string | null {
  if (gstinBlocksScratch(input.gstNumber)) return BLOCKED_TN;
  if (input.scratchBlocked === true) return BLOCKED_PLATFORM;
  if (!input.accountsOn) return SWITCH_NEEDS_SIGN_IN;
  return input.levelsOn ? null : CAMPAIGNS_NEED_LEVELS;
}
