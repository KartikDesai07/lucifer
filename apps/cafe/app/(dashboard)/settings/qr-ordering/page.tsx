"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { SelfOrderCard } from "@/components/settings/SelfOrderCard";
import { PromoCodesFields } from "@/components/settings/PromoCodesFields";

export default function QrOrderingSettingsPage() {
  return (
    <SettingsSectionPage slug="qr-ordering">
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control, register, errors }) => (
            <>
              <SelfOrderCard control={control} />
              <PromoCodesFields control={control} register={register} errors={errors} />
            </>
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
