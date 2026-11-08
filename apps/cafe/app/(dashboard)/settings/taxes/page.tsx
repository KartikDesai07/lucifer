"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { GstFields } from "@/components/settings/GstFields";

export default function TaxesSettingsPage() {
  return (
    <SettingsSectionPage slug="taxes" wide>
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section} saveBarLook="card">
          {({ control, register, setValue, watch, errors }) => (
            <GstFields control={control} register={register} setValue={setValue} watch={watch} errors={errors} settings={settings} />
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
