"use client";

import type { BillTemplate } from "@pos/shared/print-template";
import { useSlipDesignDraft, type SlipDesignDraft } from "@/hooks/use-slip-design-draft";
import { BILL_KIND } from "@/lib/print-design-kinds";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// The Bill design editor's unsaved draft (print customization S4, 04-S4-plan D2): the generic state machine in
// hooks/use-slip-design-draft.ts over the bill kind. It lives ABOVE the settings form, so the page can hand the
// form a SectionFormExtra and keep ONE Save bar, ONE dirty flag and ONE PUT.

/** The saved settings with the form's own unsaved legacy toggles laid over them: what Classic is customized FROM. */
export function legacySettingsOf(settings: Settings, values: SettingsInput): Settings {
  return {
    ...settings,
    billShowNumber: values.billShowNumber,
    billShowLogo: values.billShowLogo,
    billLogoSize: values.billLogoSize,
    billShowAddress: values.billShowAddress,
    billShowMobile: values.billShowMobile,
    billShowGstNumber: values.billShowGstNumber,
    billShowFssai: values.billShowFssai,
    billFontSize: values.billFontSize,
  };
}

export type BillDesignDraft = SlipDesignDraft<BillTemplate>;

export function useBillDesignDraft(settings: Settings): BillDesignDraft {
  return useSlipDesignDraft(BILL_KIND, settings);
}
