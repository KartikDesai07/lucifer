"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { KotPrintCard } from "@/components/settings/KotPrintCard";

export default function KitchenTicketSettingsPage() {
  return (
    <SettingsSectionPage slug="kitchen-ticket">
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control, register, setValue, watch, errors }) => (
            <KotPrintCard control={control} register={register} setValue={setValue} watch={watch} errors={errors} />
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
