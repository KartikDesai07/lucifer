"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { LoyaltyCard } from "@/components/settings/LoyaltyCard";
import { LoyaltyStampGrid } from "@/components/settings/LoyaltyStampGrid";

// CB-5A S5 — the Rewards & loyalty section page. Order follows the simplest
// path top-down: on/off toggles (LoyaltyCard) → the stamp card + its rewards.
//
// CB-5D — membership and levels are REMOVED (owner, 2026-09-15): no client
// used them, and the owner clears the stored data himself.
// LoyaltyAdvancedFields.tsx was DELETED — it existed only to hold those two
// sections plus the unit-label field; with both sections gone, the unit
// label moved into LoyaltyStampGrid (same `loyaltyRules` container) rather
// than keeping a one-field "Advanced" panel around.
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
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control, register, setValue, errors }) => (
            <>
              <LoyaltyCard control={control} register={register} errors={errors} />
              <LoyaltyStampGrid control={control} register={register} errors={errors} setValue={setValue} />
            </>
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
