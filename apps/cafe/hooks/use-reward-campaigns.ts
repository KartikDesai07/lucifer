"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  REWARD_CAMPAIGNS_ENDPOINT,
  rewardCampaignPath,
  type RewardCampaignData,
  type RewardCampaignsData,
} from "@pos/shared/reward-campaigns";
import type { RewardCampaignWriteBody } from "@pos/shared/schemas/reward-campaign.schema";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES } from "@/lib/query";
import { CREATE_FAILED, CREATED_TOAST, END_FAILED, ENDED_TOAST } from "@/lib/festival-cards-view";

// CB-7 S6 session 3 (E2) — the owner's festival-card campaigns. Admin data (the routes are admin-only), so the list is
// never treated as fresh: every visit asks again, and the issued count moves whenever a customer opens their rewards.

export const REWARD_CAMPAIGN_KEYS = {
  all: ["reward-campaigns"] as const,
};

export function useRewardCampaigns() {
  return useQuery({
    queryKey: REWARD_CAMPAIGN_KEYS.all,
    queryFn: () => apiGet<RewardCampaignsData>(REWARD_CAMPAIGNS_ENDPOINT),
    staleTime: STALE_TIMES.LIVE,
  });
}

// POST — the sheet closes on success (it awaits mutateAsync); an error is toasted here with the server's own sentence.
export function useCreateRewardCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RewardCampaignWriteBody) => apiSend<RewardCampaignData>(REWARD_CAMPAIGNS_ENDPOINT, "POST", body),
    onSuccess: () => toast.success(CREATED_TOAST),
    onError: (err: Error) => toast.error(err.message || CREATE_FAILED),
    onSettled: () => qc.invalidateQueries({ queryKey: REWARD_CAMPAIGN_KEYS.all }),
  });
}

// PATCH { end: true } — ends a campaign now; cards already given stay.
export function useEndRewardCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<RewardCampaignData>(rewardCampaignPath(id), "PATCH", { end: true }),
    onSuccess: () => toast.success(ENDED_TOAST),
    onError: (err: Error) => toast.error(err.message || END_FAILED),
    onSettled: () => qc.invalidateQueries({ queryKey: REWARD_CAMPAIGN_KEYS.all }),
  });
}
