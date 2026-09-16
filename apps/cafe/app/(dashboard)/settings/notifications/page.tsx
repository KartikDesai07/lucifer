"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { IntegrationsFields } from "@/components/settings/IntegrationsFields";

export default function NotificationsSettingsPage() {
  return (
    <SettingsSectionPage slug="notifications">
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control }) => <IntegrationsFields control={control} />}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
