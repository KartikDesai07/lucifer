"use client";

import type { UseFormGetValues } from "react-hook-form";

import { DesignGallery } from "@/components/settings/print-design/DesignGallery";
import { DesignSection } from "@/components/settings/print-design/DesignSection";
import { legacySettingsOf, type BillDesignDraft } from "@/hooks/use-bill-design-draft";
import { BILL_KIND } from "@/lib/print-design-kinds";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// The page imports the preview notice from here (it now lives with the generic section).
export { PreviewLoadNotice } from "@/components/settings/print-design/DesignSection";

interface BillDesignSectionProps {
  design: BillDesignDraft;
  /** The SAVED settings. */
  settings: Settings;
  /** The form's live values at click time: Classic is started from the toggles as they stand on screen. */
  getValues: UseFormGetValues<SettingsInput>;
}

// "Bill design": the four designs, then (once one is picked) every line of the bill and its font and size. Every
// change is only the unsaved draft; the page's one Save bar saves it with the rest of the form.
export function BillDesignSection({ design, settings, getValues }: BillDesignSectionProps) {
  return (
    <DesignSection
      kind={BILL_KIND}
      design={design}
      settings={settings}
      legacy={() => legacySettingsOf(settings, getValues())}
      gallery={(args) => <DesignGallery settings={settings} {...args} />}
    />
  );
}
