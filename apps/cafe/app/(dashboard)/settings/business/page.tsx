"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { BusinessDetailsFields } from "@/components/settings/BusinessDetailsFields";

export default function BusinessSettingsPage() {
  return (
    <SettingsSectionPage slug="business" wide>
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section} saveBarLook="card">
          {({ control, register, errors }) => (
            <BusinessDetailsFields control={control} register={register} errors={errors} settings={settings} />
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
