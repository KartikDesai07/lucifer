/**
 * Shared fixtures + helpers of the CB-7 S6 session 3 live leg (verify-reward-campaigns-live.ts): campaign / diner
 * seeders, the REAL wallet + issue ports with only the environment replaced and every database call COUNTED, a barrier
 * for the concurrent legs and the route call shapes. (ops CLI support module, not app code.)
 */
import mongoose, { type Types } from "mongoose";

import { Customer } from "@/models/Customer";
import { RewardCampaign } from "@/models/RewardCampaign";
import { DINER_CARDS_DEPS, type DinerCardsDeps, type WalletRead } from "@/lib/reward-cards-read";
import { REWARD_CAMPAIGN_ISSUE_DEPS, issueCampaignCards, type RewardCampaignIssueDeps } from "@/lib/reward-campaign-issue";
import type { ISettings } from "@/models/Settings";
import { CLEAN_ENV } from "./reward-progress-live-kit";
import { newCustomer } from "./reward-levels-live-kit";

export type Rec = Record<string, unknown>;
const MS_PER_HOUR = 3_600_000;
export const hoursFrom = (d: Date, h: number): Date => new Date(d.getTime() + h * MS_PER_HOUR);

// A box the WRITE gate accepts (one bill-percent option) - the same shape the owner's form sends.
export const BOX = { scratchDays: 5, useDays: 10, options: [{ kind: "bill-percent", id: "c1", weight: 1, min: 5, max: 10 }] };

/** A campaign row inserted straight (so a leg controls the window), live by default: from an hour ago to an hour ahead. */
export async function newCampaign(over: Rec = {}): Promise<Types.ObjectId> {
  const now = new Date();
  const doc = await RewardCampaign.create({
    name: "Diwali treat",
    audience: "everyone",
    issued: 0,
    startsAt: hoursFrom(now, -1),
    endsAt: hoursFrom(now, 1),
    box: BOX,
    ...over,
  });
  return doc._id as Types.ObjectId;
}
export const issuedOf = async (id: Types.ObjectId): Promise<number> => ((await RewardCampaign.collection.findOne({ _id: id })) as Rec | null)?.issued as number;

/** An enrolled diner (anchored); `extra` overrides (pass {} + anchor false for a not-enrolled diner). */
export const enrolled = (extra: Rec = {}): Promise<Types.ObjectId> => newCustomer(undefined, { rewardsAnchorAt: new Date(), ...extra });
export const notEnrolled = (): Promise<Types.ObjectId> => newCustomer();
export async function heldOf(id: Types.ObjectId): Promise<Rec[]> {
  const row = (await Customer.collection.findOne({ _id: id })) as Rec | null;
  return (row?.rewardCards ?? []) as Rec[];
}

// Every database call of the issue step, counted; the REAL ports run underneath.
export interface Calls { find: number; reserve: number; push: number; pushMatched: number[]; release: number }
export interface Counted { deps: RewardCampaignIssueDeps; calls: Calls }
export function countedIssue(env: NodeJS.ProcessEnv = CLEAN_ENV, over: Partial<RewardCampaignIssueDeps> = {}): Counted {
  const calls: Calls = { find: 0, reserve: 0, push: 0, pushMatched: [], release: 0 };
  const real = { ...REWARD_CAMPAIGN_ISSUE_DEPS, ...over };
  const deps: RewardCampaignIssueDeps = {
    ...real,
    env,
    findActive: (customerId, now) => (calls.find++, real.findActive(customerId, now)),
    reserve: (campaignId, now) => (calls.reserve++, real.reserve(campaignId, now)),
    pushCard: async (filter, update) => {
      calls.push++;
      const res = await real.pushCard(filter, update);
      calls.pushMatched.push(res.matchedCount);
      return res;
    },
    release: (campaignId) => (calls.release++, real.release(campaignId)),
  };
  return { deps, calls };
}

// The REAL wallet read with the issue step routed through `issue` (default: the counted real deps on a clean env).
export function walletDeps(issue: Counted, env: NodeJS.ProcessEnv = CLEAN_ENV, over: Partial<DinerCardsDeps> = {}): DinerCardsDeps {
  return {
    ...DINER_CARDS_DEPS,
    env,
    issueCampaigns: (settings: ISettings | null, customerId: string, wallet: WalletRead) => issueCampaignCards(settings, customerId, wallet, issue.deps),
    ...over,
  };
}

/** readWallet wrapper: the first n reads wait for each other (barrier), so every racer has pre-read before any writes. */
export function readBarrier(n: number): NonNullable<DinerCardsDeps["readWallet"]> {
  let reads = 0;
  let waiting = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return async (customerId) => {
    reads += 1;
    const mine = reads;
    const value = await DINER_CARDS_DEPS.readWallet(customerId);
    if (mine <= n) {
      waiting += 1;
      if (waiting === n) release();
      await gate;
    }
    return value;
  };
}

/** A start gate: every racer awaits it, then all run at once. */
export function startGate(): { wait: Promise<void>; go: () => void } {
  let go: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => (go = resolve));
  return { wait, go };
}

// ── Route call shapes (admin stub is installed by installStubs) ──────────────────────────────────────────────────
export interface CampaignApi {
  post: (body: unknown) => Promise<{ status: number; body: { success: boolean; data?: Rec; error?: string } }>;
  end: (id: string) => Promise<{ status: number; body: { success: boolean; data?: Rec; error?: string } }>;
}
export async function loadCampaignApi(): Promise<CampaignApi> {
  const list = await import("@/app/api/reward-campaigns/route");
  const one = await import("@/app/api/reward-campaigns/[id]/route");
  const req = (method: string, url: string, body: unknown): Request =>
    new Request(`http://127.0.0.1${url}`, { method, headers: { "content-type": "application/json", host: "127.0.0.1" }, body: JSON.stringify(body) });
  const answer = async (pending: Promise<Response>) => {
    const res = await pending;
    return { status: res.status, body: (await res.json()) as { success: boolean; data?: Rec; error?: string } };
  };
  return {
    post: (body) => answer(list.POST(req("POST", "/api/reward-campaigns", body))),
    end: (id) => answer(one.PATCH(req("PATCH", `/api/reward-campaigns/${id}`, { end: true }), { params: Promise.resolve({ id }) })),
  };
}

export const dbIndexes = async (): Promise<Rec[]> => (await mongoose.connection.collection("rewardcampaigns").indexes()) as Rec[];
