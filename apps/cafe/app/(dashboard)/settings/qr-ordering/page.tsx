"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { SelfOrderCard } from "@/components/settings/SelfOrderCard";
import { PromoCodesFields } from "@/components/settings/PromoCodesFields";
import { DinerBannersFields } from "@/components/settings/DinerBannersFields";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";
import { SETTINGS_STACK_CLASS } from "@/lib/settings-card-layout";

export default function QrOrderingSettingsPage() {
  return (
    <SettingsSectionPage slug="qr-ordering">
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section} saveBarLook="card">
          {({ control, register, errors }) => (
            // One column of cards at every width: this page has no preview, so it stays in the
            // narrow shell. The cards are siblings of one grid, which sets the gap between them.
            <div className={SETTINGS_STACK_CLASS}>
              <SelfOrderCard control={control} />
              <PromoCodesFields control={control} register={register} errors={errors} />
              <DinerBannersFields
                dinerAccountsOn={settingsFormDefaults(settings).dinerAccountsEnabled === true}
                control={control}
                register={register}
                errors={errors}
              />
            </div>
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
