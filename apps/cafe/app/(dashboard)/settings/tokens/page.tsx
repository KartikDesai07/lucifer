"use client";

import { ArrowDown } from "lucide-react";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { HINT_CLASS, SettingsGroup } from "@/components/settings/SettingsFields";
import { TokenSettingsFields } from "@/components/settings/TokenSettingsFields";
import { TokenSlipPreview } from "@/components/settings/TokenSlipPreview";
import { PreviewLoadNotice } from "@/components/settings/print-design/DesignSection";
import { TokenDesignSection } from "@/components/settings/print-design/TokenDesignSection";
import { tokenTemplateNeedsSlipCode } from "@/components/print/slip/slip-code";
import { useTokenDesignDraft } from "@/hooks/use-token-design-draft";
import type { SettingsSection } from "@/lib/settings-sections";
import type { Settings } from "@/types";

// Settings on the left, a live sample token slip on the right that stays in view on a computer. Below lg the slip
// stacks under the settings, with a jump link at the top. The sticky column clears the 56px header (top-20) and the
// sticky save bar (11rem) so the whole slip can scroll inside it.
export default function TokensSettingsPage() {
  return (
    <SettingsSectionPage slug="tokens" wide>
      {(settings, section) => <TokensForm settings={settings} section={section} />}
    </SettingsSectionPage>
  );
}

// The design draft lives above the form (hooks/use-token-design-draft.ts), so this one form's Save bar and single PUT
// carry both the form's fields and the design.
function TokensForm({ settings, section }: { settings: Settings; section: SettingsSection }) {
  const design = useTokenDesignDraft(settings);

  return (
    <SettingsSectionForm settings={settings} section={section} extra={design.extra}>
      {({ control, register, setValue, errors }) => (
        <div className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-8 lg:space-y-0">
          <div className="min-w-0 space-y-6">
            <a
              href="#token-preview"
              className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-primary lg:hidden"
            >
              <ArrowDown aria-hidden="true" className="h-4 w-4" />
              See the slip
            </a>
            <TokenSettingsFields control={control} register={register} setValue={setValue} errors={errors} />
            <TokenDesignSection design={design} settings={settings} control={control} />
          </div>
          <div className="border-t border-brand-rule pt-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:border-t-0 lg:pt-0">
            <SettingsGroup
              stacked
              id="token-preview"
              title="Slip preview"
              description="A sample token slip with these settings. It changes as you edit."
              panelClassName="bg-brand-wash p-3 sm:p-4"
            >
              <PreviewLoadNotice template={design.draft} needsCode={tokenTemplateNeedsSlipCode} />
              <TokenSlipPreview control={control} settings={{ ...settings, tokenTemplate: design.draft }} />
              <p className={HINT_CLASS}>It prints on the same paper as the bill. To see it on paper, save, then press Token on any order in Orders.</p>
            </SettingsGroup>
          </div>
        </div>
      )}
    </SettingsSectionForm>
  );
}
