"use client";

import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api-client";

// CB-7 S3 — whether scratch cards are blocked on this platform (the owner's env switch). The settings document carries
// no server-computed booleans, so the editor asks this small admin route. `scratchBlocked` stays undefined while it
// loads and when the read fails, so the page shows no block note it cannot vouch for.

export const REWARD_LEVELS_STATUS_KEY = ["reward-levels-status"] as const;

interface RewardLevelsStatus {
  scratchBlocked: boolean;
}

export function useRewardLevelsStatus(): { scratchBlocked: boolean | undefined } {
  const { data } = useQuery({
    queryKey: REWARD_LEVELS_STATUS_KEY,
    queryFn: () => apiGet<RewardLevelsStatus>("/api/settings/reward-levels"),
    staleTime: 0,
  });
  return { scratchBlocked: data?.scratchBlocked };
}
