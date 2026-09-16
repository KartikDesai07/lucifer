"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { AppearanceFields } from "@/components/settings/AppearanceFields";

export default function AppearanceSettingsPage() {
  return (
    <SettingsSectionPage slug="appearance" wide>
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control }) => <AppearanceFields control={control} />}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
