// CB-7 S6 session 3 (plan §2.8, owner O4) — festival cards: an owner-run campaign that gives ONE scratch card to each
// picked (or every) diner with an account, lazily, the first time their wallet loads inside the campaign's dates. Cards
// are given only while Reward levels are EARNING (same switch, same Tamil Nadu guard — O4). The shared CONTRACT:
// limits, the audience enum, endpoints, DTOs, the window/status helpers and plain-English copy.
// PURE, client-safe. Imported by path (`@pos/shared/reward-campaigns`), never through the barrel. The write gate is
// schemas/reward-campaign.schema.ts.

import { REWARD_DAYS_MAX, type RewardSlot } from "./reward-levels";
import { dayRange } from "./utils";

// Campaigns not yet ended (planned or running) at one time. The wallet's issue step reads at most this many, so the
// create route refuses a fourth (two racing creates can still make four; the issue then skips the newest until one
// ends — stated, not guarded: admin-only and harmless).
export const CAMPAIGNS_ACTIVE_MAX = 3;
// Picked diners per campaign (the stored id array and the issue query's multikey match stay small).
export const CAMPAIGN_CUSTOMERS_MAX = 500;
// The optional card budget ("only the first N diners"): reserved with a guarded $inc before each card is pushed.
export const CAMPAIGN_MAX_CARDS_MIN = 1;
export const CAMPAIGN_MAX_CARDS_MAX = 100_000;
// The window's length in days, first and last day included.
export const CAMPAIGN_DAYS_MAX = REWARD_DAYS_MAX;
// The owner's list shows this many, latest-ending first, so every campaign not yet ended is on it (one name lookup
// covers every picked diner on the page).
export const CAMPAIGNS_LIST_MAX = 20;

export const CAMPAIGN_AUDIENCES = ["picked", "everyone"] as const;
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];

// A campaign card's issueKey ("camp:<campaignId>") — one card per diner per campaign, guarded in the push filter.
export const CAMPAIGN_ISSUE_KEY_PREFIX = "camp:";
export function campaignIssueKey(campaignId: string): string {
  return `${CAMPAIGN_ISSUE_KEY_PREFIX}${campaignId}`;
}

// ── Endpoints (admin-only) and the owner page ────────────────────────────────────────────────────────────────────
export const REWARD_CAMPAIGNS_ENDPOINT = "/api/reward-campaigns";
export function rewardCampaignPath(id: string): string {
  return `${REWARD_CAMPAIGNS_ENDPOINT}/${encodeURIComponent(id)}`;
}
export const FESTIVAL_CARDS_PAGE = "/customers/festival-cards";

// ── DTOs (dates are epoch milliseconds, the /me precedent) ───────────────────────────────────────────────────────
// The one box a campaign gives from: the same grammar as a level's box, minus the step.
export type CampaignBox = Pick<RewardSlot, "scratchDays" | "useDays" | "options">;

// A picked diner as the owner's list shows them: the NAME only, never a mobile number.
export interface CampaignCustomerRef {
  id: string;
  name: string;
}

export interface RewardCampaignDto {
  id: string;
  name: string;
  audience: CampaignAudience;
  customers: CampaignCustomerRef[]; // picked only ([] for "everyone"); a deleted diner is left out
  maxCards: number | null;
  issued: number;
  startsAt: number; // the first day's 00:00 IST
  endsAt: number; // the last day's 23:59:59.999 IST, or the "End now" instant
  endedEarly: boolean; // "End now" was used
  createdAt: number;
  box: CampaignBox;
}

// GET /api/reward-campaigns — latest-ending first (every campaign not yet ended, then the most recently ended). POST answers { campaign }; PATCH (end now) answers { campaign }.
export interface RewardCampaignsData {
  campaigns: RewardCampaignDto[];
}
export interface RewardCampaignData {
  campaign: RewardCampaignDto;
}

// ── Window + status (inclusive at both ends — the same instants the issue filter uses) ───────────────────────────
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
// Noon UTC lies inside the same IST calendar day (17:30 IST), so dayRange resolves the picked day, not a neighbour.
const atNoonUtc = (ymd: string): Date => new Date(`${ymd}T12:00:00Z`);

/** The IST instants of a picked day range: the first day's 00:00 to the last day's 23:59:59.999. */
export function campaignWindow(startDay: string, endDay: string): { startsAt: Date; endsAt: Date } {
  return { startsAt: dayRange(atNoonUtc(startDay)).start, endsAt: dayRange(atNoonUtc(endDay)).end };
}

/** Days in a "YYYY-MM-DD" range, first and last included (1 for a one-day campaign). */
export function campaignDays(startDay: string, endDay: string): number {
  return Math.round((atNoonUtc(endDay).getTime() - atNoonUtc(startDay).getTime()) / ONE_DAY_MS) + 1;
}

export type CampaignStatus = "upcoming" | "live" | "ended";
export function campaignStatusAt(window: { startsAt: number; endsAt: number }, nowMs: number): CampaignStatus {
  if (nowMs > window.endsAt) return "ended";
  if (nowMs < window.startsAt) return "upcoming";
  return "live";
}

// ── Owner-facing copy (plain English, never a cafe name) ─────────────────────────────────────────────────────────
export const FESTIVAL_CARDS_TITLE = "Festival cards";
export const FESTIVAL_CARDS_INTRO =
  "Give one scratch card to your customers for a festival or a special day. Each customer gets one card the first " +
  "time they open their rewards during the dates. Only customers with an account get a card.";
export const CAMPAIGNS_NEED_LEVELS = "Festival cards are given out only while Reward levels are switched on.";
export const CAMPAIGN_STATUS_WORDS: Readonly<Record<CampaignStatus, string>> = {
  upcoming: "Starts later",
  live: "Running",
  ended: "Ended",
};
export const CAMPAIGN_AUDIENCE_WORDS: Readonly<Record<CampaignAudience, string>> = {
  picked: "Customers I pick",
  everyone: "Every customer with an account",
};
export const CAMPAIGN_LIMIT_REACHED =
  `You can have at most ${CAMPAIGNS_ACTIVE_MAX} festival campaigns planned or running at once. End one first.`;
export const CAMPAIGN_NOT_FOUND = "This festival campaign no longer exists.";
export const CAMPAIGN_ALREADY_ENDED = "This festival campaign has already ended.";
export const CAMPAIGN_DAY_PASSED = "The last day has already passed. Pick today or a later day.";
export const CAMPAIGN_CUSTOMERS_GONE = "Some picked customers no longer exist. Pick the customers again.";
