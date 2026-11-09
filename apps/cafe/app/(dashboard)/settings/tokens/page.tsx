"use client";

import { ArrowDown } from "lucide-react";

import { SettingsSectionPage } from "@/components/settings/SettingsSectionPage";
import { SettingsSectionForm } from "@/components/settings/SettingsSectionForm";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { TokenSettingsFields } from "@/components/settings/TokenSettingsFields";
import { TokenSlipPreview } from "@/components/settings/TokenSlipPreview";
import { PreviewLoadNotice } from "@/components/settings/print-design/DesignSection";
import { TokenDesignSection } from "@/components/settings/print-design/TokenDesignSection";
import { tokenTemplateNeedsSlipCode } from "@/components/print/slip/slip-code";
import { useTokenDesignDraft } from "@/hooks/use-token-design-draft";
import {
  SETTINGS_HINT_CLASS,
  SETTINGS_MAIN_CARD_CLASS,
  SETTINGS_PREVIEW_GRID_CLASS,
  SETTINGS_STACK_CLASS,
  TOKENS_PREVIEW_CLASS,
} from "@/lib/settings-card-layout";
import type { SettingsSection } from "@/lib/settings-sections";
import { cn } from "@/lib/utils";
import type { Settings } from "@/types";

// One stack of cards; from xl (1280px) the live sample token slip is a sticky 340px column on the right that scrolls
// inside itself. Below xl the slip comes last, with a jump link at the top. The form cards share ONE stack in column 1
// because the slip design adds one or three cards (Customize), so the preview cannot span a fixed number of rows.
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
    <SettingsSectionForm settings={settings} section={section} extra={design.extra} saveBarLook="card">
      {({ control, register, setValue, errors }) => (
        <div className={SETTINGS_PREVIEW_GRID_CLASS}>
          <a
            href="#token-preview"
            className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-semibold text-primary xl:hidden"
          >
            <ArrowDown aria-hidden="true" className="h-4 w-4" />
            See the slip
          </a>
          <div className={cn(SETTINGS_STACK_CLASS, SETTINGS_MAIN_CARD_CLASS)}>
            <TokenSettingsFields control={control} register={register} setValue={setValue} errors={errors} />
            <TokenDesignSection design={design} settings={settings} control={control} />
          </div>
          <SettingsCard
            id="token-preview"
            title="Slip preview"
            sub="A sample token slip with these settings. It changes as you edit."
            className={TOKENS_PREVIEW_CLASS}
            bodyClassName="grid gap-3 rounded-b-[12px] bg-surface-2 p-3"
          >
            <PreviewLoadNotice template={design.draft} needsCode={tokenTemplateNeedsSlipCode} />
            <TokenSlipPreview control={control} settings={{ ...settings, tokenTemplate: design.draft }} />
            <p className={SETTINGS_HINT_CLASS}>It prints on the same paper as the bill. To see it on paper, save, then press Reprint token on any order in Orders.</p>
          </SettingsCard>
        </div>
      )}
    </SettingsSectionForm>
  );
}
