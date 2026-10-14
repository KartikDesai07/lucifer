import { campaignIssueKey } from "@pos/shared/reward-campaigns";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import { buildCardSnapshot, deadlineFrom, type RewardRng } from "@pos/shared/reward-levels-engine";
import { parseStoredCampaignBox } from "@pos/shared/schemas/reward-campaign.schema";
import { Customer } from "@/models/Customer";
import { RewardCampaign } from "@/models/RewardCampaign";
import type { ISettings } from "@/models/Settings";
import {
  ACTIVE_CAMPAIGNS_LIMIT,
  ACTIVE_CAMPAIGNS_SELECT,
  ACTIVE_CAMPAIGNS_SORT,
  RELEASE_UPDATE,
  RESERVE_UPDATE,
  activeCampaignsFilter,
  pushFilter,
  pushUpdate,
  reserveFilter,
  wouldBeSlicedOff,
} from "@/lib/reward-campaign-issue-plan";
import { rewardLevelsEarning } from "@/lib/reward-levels-config";
import { cryptoRng, newRewardCardId } from "@/lib/reward-rng";

// CB-7 S6 session 3 (plan section 2.8, owner fork O4) - festival cards, issued LAZILY when a diner's wallet loads: the
// first load inside a campaign's dates gives that diner ONE card from the campaign's box. Cards are given only while Reward
// levels are EARNING (same switch, same Tamil Nadu block). The pure shapes live in lib/reward-campaign-issue-plan.ts; this
// file runs them. SERVER-ONLY (registered in client-graph-guard.test.ts).
//
// Exactly-once, three fences: the push filter refuses a wallet that already holds "camp:<id>"; the budget is RESERVED with a
// guarded $inc before the push; a push that provably matched nothing gives its reservation back. A THROWN error is never
// compensated (the write may have landed - never revert on a throw), and the whole step swallows errors: a festival card
// is a bonus, never a reason the wallet fails to load.

// What the issue step needs of the diner's pre-read: whether they are in the programme, and what they already hold.
// `pinSetAt` stands in for "holds a PIN" - a PIN set writes both together; the credential itself is never read.
export interface IssueWallet {
  rewardsAnchorAt?: Date;
  pinSetAt?: Date;
  rewardCards?: readonly Pick<RewardCardSnapshot, "issueKey" | "keepUntil">[];
}

export interface CampaignRow {
  _id: { toString(): string };
  name: string;
  box: unknown;
}

// The seam the tests fake: every database call and every source of time / randomness / environment.
export interface RewardCampaignIssueDeps {
  findActive(customerId: string, now: Date): Promise<CampaignRow[]>;
  reserve(campaignId: string, now: Date): Promise<{ matchedCount: number }>;
  pushCard(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ matchedCount: number }>;
  release(campaignId: string): Promise<void>;
  rng: RewardRng;
  newCardId: () => string;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export const REWARD_CAMPAIGN_ISSUE_DEPS: RewardCampaignIssueDeps = {
  findActive: (customerId, now) =>
    RewardCampaign.find(activeCampaignsFilter(customerId, now))
      .select(ACTIVE_CAMPAIGNS_SELECT)
      .sort(ACTIVE_CAMPAIGNS_SORT)
      .limit(ACTIVE_CAMPAIGNS_LIMIT)
      .lean(),
  reserve: async (campaignId, now) => {
    const res = await RewardCampaign.updateOne(reserveFilter(campaignId, now), RESERVE_UPDATE);
    return { matchedCount: res.matchedCount };
  },
  pushCard: async (filter, update) => {
    const res = await Customer.updateOne(filter, update);
    return { matchedCount: res.matchedCount };
  },
  release: async (campaignId) => {
    await RewardCampaign.updateOne({ _id: campaignId }, RELEASE_UPDATE);
  },
  rng: cryptoRng,
  newCardId: newRewardCardId,
  now: () => new Date(),
  env: process.env,
};

/**
 * Gives this diner a card from every active campaign they have not already got one from. Returns how many cards were
 * pushed (0 when nothing applies). NEVER throws: an error stops the step and the cards pushed so far are still counted.
 */
export async function issueCampaignCards(
  settings: ISettings | null,
  customerId: string,
  wallet: IssueWallet,
  deps: RewardCampaignIssueDeps = REWARD_CAMPAIGN_ISSUE_DEPS,
): Promise<number> {
  // Fork O4: no cards while Reward levels are not earning (switched off, Tamil Nadu block, unreadable config).
  if (!rewardLevelsEarning(settings, deps.env)) return 0;
  // Not in the programme (never anchored, no PIN): the push filter would refuse anyway - skip the reads.
  if (!wallet.rewardsAnchorAt && !wallet.pinSetAt) return 0;

  const now = deps.now();
  const held = new Set((wallet.rewardCards ?? []).map((card) => card.issueKey));
  // The wallet as this load leaves it: a card pushed earlier in the loop counts toward the full-wallet check below.
  const cards: Pick<RewardCardSnapshot, "keepUntil">[] = [...(wallet.rewardCards ?? [])];
  let issued = 0;
  try {
    for (const campaign of await deps.findActive(customerId, now)) {
      const id = campaign._id.toString();
      const issueKey = campaignIssueKey(id);
      if (held.has(issueKey)) continue;
      const box = parseStoredCampaignBox(campaign.box);
      if (box === null) continue; // a box this build cannot read skips the campaign, never throws
      // A full wallet would slice the new card off in the push itself (its keepUntil is the scratch-by date the card gets).
      if (wouldBeSlicedOff(cards, deadlineFrom(now.getTime(), box.scratchDays))) continue;

      if ((await deps.reserve(id, now)).matchedCount === 0) continue; // budget gone, or the campaign just ended

      const card = buildCardSnapshot({
        id: deps.newCardId(),
        issueKey,
        source: "campaign",
        campaignId: id,
        title: campaign.name,
        slot: box,
        rng: deps.rng,
        now,
      });
      const pushed = await deps.pushCard(pushFilter(customerId, issueKey), pushUpdate(card));
      if (pushed.matchedCount === 0) {
        // Already held (a twin request won) or no longer in the programme: nothing was written, so the reservation goes back.
        await deps.release(id);
        continue;
      }
      issued += 1;
      cards.push(card);
    }
  } catch {
    // Swallowed on purpose (see the header): the wallet must still load. No compensation - the throwing write may have landed.
  }
  return issued;
}
