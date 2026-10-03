"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { SelfOrderCard } from "@/components/settings/SelfOrderCard";
import { PromoCodesFields } from "@/components/settings/PromoCodesFields";
import { DinerBannersFields } from "@/components/settings/DinerBannersFields";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";

export default function QrOrderingSettingsPage() {
  return (
    <SettingsSectionPage slug="qr-ordering">
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control, register, errors }) => (
            // One parent for every group: SettingsGroup's first:border-t-0 and
            // the space-y-6 rhythm need them to be siblings.
            <div className="space-y-6">
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
