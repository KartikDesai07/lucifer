"use client";

import { ChevronDown } from "lucide-react";

import {
  CAMPAIGN_AUDIENCE_WORDS,
  CAMPAIGN_STATUS_WORDS,
  campaignStatusAt,
  type CampaignStatus,
  type RewardCampaignDto,
} from "@pos/shared/reward-campaigns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { REWARD_BUTTON_CLASS, REWARD_CARD_CLASS } from "@/components/settings/rewards/reward-ui";
import { END_NOW_LABEL, campaignDatesText, cardsGivenText, pickedCountText } from "@/lib/festival-cards-view";

const STATUS_BADGE: Record<CampaignStatus, "default" | "secondary" | "outline"> = {
  live: "default",
  upcoming: "secondary",
  ended: "outline",
};

interface FestivalCampaignRowProps {
  campaign: RewardCampaignDto;
  nowMs: number;
  onEnd: (campaign: RewardCampaignDto) => void;
}

// One campaign: its name and status, its dates, who it is for (a picked list opens to show the names, never a mobile
// number), how many cards it has given, and "End now" while it is not over.
export function FestivalCampaignRow({ campaign, nowMs, onEnd }: FestivalCampaignRowProps) {
  const status = campaignStatusAt(campaign, nowMs);
  const picked = campaign.audience === "picked";

  return (
    <li className={REWARD_CARD_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <p className="min-w-0 truncate text-sm font-semibold text-brand-ink">{campaign.name}</p>
          <Badge variant={STATUS_BADGE[status]} className="shrink-0">
            {CAMPAIGN_STATUS_WORDS[status]}
          </Badge>
        </div>
        {status !== "ended" && (
          <Button type="button" variant="outline" className={`${REWARD_BUTTON_CLASS} shrink-0`} onClick={() => onEnd(campaign)}>
            {END_NOW_LABEL}
          </Button>
        )}
      </div>

      <p className="text-sm text-brand-ink">{campaignDatesText(campaign.startsAt, campaign.endsAt, nowMs)}</p>
      <p className={HINT_CLASS}>{cardsGivenText(campaign.issued, campaign.maxCards)}</p>

      {picked ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="h-11 w-full justify-between px-2 text-sm font-normal text-brand-ink">
              {pickedCountText(campaign.customers.length)}
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="max-h-48 space-y-1 overflow-y-auto px-2 pb-1 text-sm text-brand-ink">
              {campaign.customers.map((customer) => (
                <li key={customer.id} className="truncate">
                  {customer.name}
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <p className="text-sm text-brand-ink">{CAMPAIGN_AUDIENCE_WORDS.everyone}</p>
      )}
    </li>
  );
}
