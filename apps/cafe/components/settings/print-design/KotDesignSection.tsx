"use client";

import type { UseFormGetValues } from "react-hook-form";

import { DesignSection } from "@/components/settings/print-design/DesignSection";
import { KotDesignGallery } from "@/components/settings/print-design/KotDesignGallery";
import { legacyKotSettingsOf, type KotDesignDraft } from "@/hooks/use-kot-design-draft";
import { KOT_KIND } from "@/lib/print-design-kinds";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

interface KotDesignSectionProps {
  design: KotDesignDraft;
  /** The SAVED settings. */
  settings: Settings;
  /** The form's live values at click time: Classic is started from the toggles as they stand on screen. */
  getValues: UseFormGetValues<SettingsInput>;
}

// "Kitchen ticket design": the ticket designs, then (once one is picked) every line of the ticket and its font and
// size. Every change is only the unsaved draft; the page's one Save bar saves it with the rest of the form.
export function KotDesignSection({ design, settings, getValues }: KotDesignSectionProps) {
  return (
    <DesignSection
      kind={KOT_KIND}
      design={design}
      settings={settings}
      legacy={() => legacyKotSettingsOf(settings, getValues())}
      gallery={(args) => <KotDesignGallery settings={settings} {...args} />}
    />
  );
}
