"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { LoyaltyCard } from "@/components/settings/LoyaltyCard";
import { LoyaltyStampGrid } from "@/components/settings/LoyaltyStampGrid";
import { RewardLevelsSection } from "@/components/settings/rewards/RewardLevelsSection";
import { useRewardLevelsDraft } from "@/hooks/use-reward-levels-draft";
import { rewardLevelsChosenRaw } from "@pos/shared/schemas/reward-levels-read.schema";
import type { SettingsSection } from "@/lib/settings-sections";
import type { Settings } from "@/types";

// CB-5A S5 — the Rewards & loyalty section page. Order follows the simplest
// path top-down: sign-in and the stamp card switch (LoyaltyCard: the groups
// "Diner accounts" and "Stamp card") → the rewards on the card (the group
// "Rewards" in LoyaltyStampGrid) → the scratch-card levels (CB-7 S3: the
// groups "Scratch cards" and "Levels" in RewardLevelsSection). Settings pass
// slice 8: three or more groups in one space-y-6 column, like Taxes and QR
// ordering.
//
// CB-5D — membership and levels are REMOVED (owner, 2026-09-15): no client
// used them, and the owner clears the stored data himself.
// LoyaltyAdvancedFields.tsx was DELETED — it existed only to hold those two
// sections plus the unit-label field. The unit label (and the card size) now
// sit in LoyaltyCard's "Stamp card" group, beside the other card-wide settings.
// (The scratch-card "levels" above are a different, newer feature.)
//
// The "Start from a template" picker was REMOVED from this page (owner,
// 2026-09-14): the card is configured directly on the grid below instead.
// `wide` for the same reason the appearance page takes it — the stamp grid is
// a row of boxes, and at max-w-3xl it wrapped early while the right-hand side
// of the page sat empty.
// components/settings/LoyaltyTemplateCard.tsx is deliberately KEPT (with its
// pins in lib/loyalty-template-paths.test.ts, which read that file directly)
// so the presets can be restored without rewriting them.
export default function LoyaltySettingsPage() {
  return (
    <SettingsSectionPage slug="loyalty" wide>
      {(settings, section) => <LoyaltyForm settings={settings} section={section} />}
    </SettingsSectionPage>
  );
}

// The levels draft lives above the form (hooks/use-reward-levels-draft.ts), so this one form's Save bar and single
// PUT carry both the form's fields and the scratch-card levels.
function LoyaltyForm({ settings, section }: { settings: Settings; section: SettingsSection }) {
  const levels = useRewardLevelsDraft(settings);

  return (
    <SettingsSectionForm settings={settings} section={section} extra={levels.extra}>
      {({ control, register, setValue, getValues, errors }) => (
        <div className="space-y-6">
          <LoyaltyCard control={control} register={register} errors={errors} levelsChosen={rewardLevelsChosenRaw(settings.rewardLevels)} />
          <LoyaltyStampGrid control={control} register={register} errors={errors} setValue={setValue} />
          <RewardLevelsSection levels={levels} settings={settings} control={control} getValues={getValues} />
        </div>
      )}
    </SettingsSectionForm>
  );
}
