"use client";

import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";

import {
  CAMPAIGNS_ACTIVE_MAX,
  FESTIVAL_CARDS_INTRO,
  type RewardCampaignDto,
} from "@pos/shared/reward-campaigns";
import { useEndRewardCampaign, useRewardCampaigns } from "@/hooks/use-reward-campaigns";
import { useNow } from "@/hooks/use-now";
import { useRewardLevelsStatus } from "@/hooks/use-reward-levels-status";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { HINT_CLASS } from "@/components/settings/hint-classes";
import { REWARD_BUTTON_CLASS, REWARD_NOTE_CLASS } from "@/components/settings/rewards/reward-ui";
import { FestivalCampaignRow } from "@/components/customers/festival/FestivalCampaignRow";
import { FestivalCardForm } from "@/components/customers/festival/FestivalCardForm";
import { seedRewardLevels } from "@/lib/reward-levels-form";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";
import {
  EMPTY_DESCRIPTION,
  EMPTY_TITLE,
  END_CONFIRM_DESCRIPTION,
  END_CONFIRM_TITLE,
  END_NOW_LABEL,
  LIMIT_REACHED_NOTE,
  LOAD_FAILED,
  NEW_CAMPAIGN_LABEL,
  festivalNotice,
  notEndedCount,
} from "@/lib/festival-cards-view";

// The status words follow the clock, so "Running" turns "Ended" without a reload.
const CLOCK_TICK_MS = 60_000;
const SKELETON_ROWS = 2;

// The Festival cards screen body: the intro, a notice when Reward levels are off, "New campaign" (hidden while the
// limit of planned or running campaigns is reached, with the reason shown instead), and one row per campaign.
export function FestivalCardsList() {
  const campaigns = useRewardCampaigns();
  const settings = useSettings();
  const endCampaign = useEndRewardCampaign();
  const now = useNow(CLOCK_TICK_MS);
  const [formOpen, setFormOpen] = useState(false);
  const [ending, setEnding] = useState<RewardCampaignDto | null>(null);

  const rows = campaigns.data?.campaigns ?? [];
  const nowMs = now?.getTime() ?? null;
  const status = useRewardLevelsStatus();
  // Shown only once the settings have loaded, so the notice never flashes on a screen whose answer is not known yet. It
  // covers every reason cards are not given: a Tamil Nadu GSTIN, the platform switch, customer sign-in off, or levels off.
  const notice =
    settings.data === undefined
      ? null
      : festivalNotice({
          accountsOn: settingsFormDefaults(settings.data).dinerAccountsEnabled === true,
          levelsOn: seedRewardLevels(settings.data.rewardLevels).baseline?.enabled === true,
          gstNumber: settings.data.gstNumber,
          scratchBlocked: status.scratchBlocked,
        });
  const atLimit = nowMs !== null && notEndedCount(rows, nowMs) >= CAMPAIGNS_ACTIVE_MAX;

  const confirmEnd = async () => {
    if (!ending) return;
    try {
      await endCampaign.mutateAsync(ending.id);
      setEnding(null);
    } catch {
      // the hook already toasted the server's sentence
    }
  };

  const addButton = (
    <Button type="button" className={REWARD_BUTTON_CLASS} onClick={() => setFormOpen(true)}>
      <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
      {NEW_CAMPAIGN_LABEL}
    </Button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-muted">{FESTIVAL_CARDS_INTRO}</p>
      {notice !== null && <p className={REWARD_NOTE_CLASS}>{notice}</p>}

      {campaigns.isLoading || nowMs === null ? (
        <div className="space-y-3" aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : campaigns.isError ? (
        <div className="space-y-2">
          <p className="text-sm text-brand-danger">{LOAD_FAILED}</p>
          <Button type="button" variant="outline" className={REWARD_BUTTON_CLASS} onClick={() => void campaigns.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-6 w-6" aria-hidden="true" />}
          title={EMPTY_TITLE}
          description={EMPTY_DESCRIPTION}
          action={addButton}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">{atLimit ? <p className={HINT_CLASS}>{LIMIT_REACHED_NOTE}</p> : addButton}</div>
          <ul className="space-y-3">
            {rows.map((campaign) => (
              <FestivalCampaignRow key={campaign.id} campaign={campaign} nowMs={nowMs} onEnd={setEnding} />
            ))}
          </ul>
        </>
      )}

      <FestivalCardForm open={formOpen} onOpenChange={setFormOpen} />

      <ConfirmDialog
        open={ending !== null}
        onOpenChange={(open) => !open && setEnding(null)}
        title={END_CONFIRM_TITLE}
        description={`"${ending?.name ?? "This campaign"}": ${END_CONFIRM_DESCRIPTION}`}
        confirmLabel={END_NOW_LABEL}
        isLoading={endCampaign.isPending}
        onConfirm={() => void confirmEnd()}
      />
    </div>
  );
}
