"use client";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { ReceiptTextCard } from "@/components/settings/ReceiptTextCard";
import { BillPrintCard } from "@/components/settings/BillPrintCard";

export default function BillPrintSettingsPage() {
  return (
    <SettingsSectionPage slug="bill-print">
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control, register, setValue, watch, errors }) => (
            <>
              <ReceiptTextCard register={register} errors={errors} />
              <BillPrintCard control={control} register={register} setValue={setValue} watch={watch} errors={errors} />
            </>
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
