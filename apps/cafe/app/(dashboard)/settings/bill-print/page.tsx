"use client";

import { ArrowDown } from "lucide-react";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { HINT_CLASS, SettingsGroup } from "@/components/settings/SettingsFields";
import { ReceiptTextCard } from "@/components/settings/ReceiptTextCard";
import { BillPrintCard } from "@/components/settings/BillPrintCard";
import { BillNumberingCard } from "@/components/settings/BillNumberingCard";
import { BillPaperFields } from "@/components/settings/BillPaperFields";
import { BillPrintPreview } from "@/components/settings/BillPrintPreview";
import { BillDesignSection, PreviewLoadNotice } from "@/components/settings/print-design/BillDesignSection";
import { useBillDesignDraft } from "@/hooks/use-bill-design-draft";
import type { SettingsSection } from "@/lib/settings-sections";
import type { Settings } from "@/types";

// Settings on the left, a live sample bill on the right that stays in view on
// a computer. Below lg the bill stacks under the settings, with a jump link at
// the top. The sticky column clears the 56px header (top-20) and the sticky
// save bar (11rem) so the whole bill can scroll inside it.
export default function BillPrintSettingsPage() {
  return (
    <SettingsSectionPage slug="bill-print" wide>
      {(settings, section) => <BillPrintForm settings={settings} section={section} />}
    </SettingsSectionPage>
  );
}

// The design draft lives above the form (hooks/use-bill-design-draft.ts), so this one form's Save bar and single
// PUT carry both the form's fields and the design.
function BillPrintForm({ settings, section }: { settings: Settings; section: SettingsSection }) {
  const design = useBillDesignDraft(settings);
  // A GST bill needs a bill number: only a hint, never an automatic switch (owner rule, plan Amendment A7).
  const gstHint = design.active && settings.gstEnabled && settings.gstRate > 0;

  return (
    <SettingsSectionForm settings={settings} section={section} extra={design.extra}>
      {({ control, register, setValue, watch, getValues, errors }) => (
        <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-8 lg:space-y-0">
          <div className="min-w-0 space-y-6">
            <a
              href="#bill-preview"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-primary lg:hidden"
            >
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
              See the bill
            </a>
            <BillDesignSection design={design} settings={settings} getValues={getValues} />
            {!design.active && <BillPrintCard control={control} watch={watch} settings={settings} />}
            <BillNumberingCard
              control={control}
              register={register}
              setValue={setValue}
              watch={watch}
              errors={errors}
              gstHint={gstHint}
            />
            <ReceiptTextCard register={register} errors={errors} />
            <BillPaperFields control={control} showTextSize={!design.active} />
          </div>
          <div className="border-t border-brand-rule pt-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:border-t-0 lg:pt-0">
            <SettingsGroup
              stacked
              id="bill-preview"
              title="Bill preview"
              description="A sample bill with these settings. It changes as you edit."
              panelClassName="bg-brand-wash p-3 sm:p-4"
            >
              <PreviewLoadNotice template={design.draft} />
              <BillPrintPreview control={control} settings={{ ...settings, billTemplate: design.draft }} />
              <p className={HINT_CLASS}>To see it on paper, save, then reprint any bill from Orders.</p>
            </SettingsGroup>
          </div>
        </div>
      )}
    </SettingsSectionForm>
  );
}
