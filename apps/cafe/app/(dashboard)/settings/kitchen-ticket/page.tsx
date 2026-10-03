"use client";

import { ArrowDown } from "lucide-react";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { SettingsGroup } from "@/components/settings/SettingsFields";
import { KotPrintCard } from "@/components/settings/KotPrintCard";
import { KotPaperFields } from "@/components/settings/KotPaperFields";
import { KitchenTicketPreview } from "@/components/settings/KitchenTicketPreview";

// Settings on the left, a live sample kitchen ticket on the right that stays in
// view on a computer. Below lg the ticket stacks under the settings, with a jump
// link at the top. The sticky column clears the 56px header (top-20) and the
// sticky save bar (11rem) so the whole ticket can scroll inside it.
export default function KitchenTicketSettingsPage() {
  return (
    <SettingsSectionPage slug="kitchen-ticket" wide>
      {(settings, section) => (
        <SettingsSectionForm settings={settings} section={section}>
          {({ control, register, setValue, watch, errors }) => (
            <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-8 lg:space-y-0">
              <div className="space-y-6">
                <a
                  href="#kot-preview"
                  className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-primary lg:hidden"
                >
                  <ArrowDown aria-hidden="true" className="h-4 w-4" />
                  See the ticket
                </a>
                <KotPrintCard
                  control={control}
                  register={register}
                  setValue={setValue}
                  watch={watch}
                  errors={errors}
                />
                <KotPaperFields control={control} />
              </div>
              <div className="border-t border-brand-rule pt-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:border-t-0 lg:pt-0">
                <SettingsGroup
                  stacked
                  id="kot-preview"
                  title="Ticket preview"
                  description="A sample kitchen ticket with these settings. It changes as you edit."
                  panelClassName="bg-brand-wash p-3 sm:p-4"
                >
                  <KitchenTicketPreview control={control} settings={settings} />
                </SettingsGroup>
              </div>
            </div>
          )}
        </SettingsSectionForm>
      )}
    </SettingsSectionPage>
  );
}
