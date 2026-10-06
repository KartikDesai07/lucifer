"use client";

import type { KotTemplate } from "@pos/shared/print-template";
import { useSlipDesignDraft, type SlipDesignDraft } from "@/hooks/use-slip-design-draft";
import { KOT_KIND } from "@/lib/print-design-kinds";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// The Kitchen ticket design editor's unsaved draft (print customization S5, 05-S5-plan D3): the generic state
// machine over the kitchen kind. Same shape as hooks/use-bill-design-draft.ts.

/**
 * The saved settings with the form's own unsaved legacy toggles laid over them: what Classic is customized FROM.
 * Exactly the fields `classicKotTemplate` reads through printConfigOf(...).kot (lib/print-template-legacy.ts):
 * the numbering start, the cancelled-slip numbering and the paper width are Settings policy, not template.
 */
export function legacyKotSettingsOf(settings: Settings, values: SettingsInput): Settings {
  return {
    ...settings,
    kotShowNumber: values.kotShowNumber,
    kotShowLogo: values.kotShowLogo,
    kotShowRestaurantName: values.kotShowRestaurantName,
    kotShowTable: values.kotShowTable,
    kotShowTime: values.kotShowTime,
    kotShowStaff: values.kotShowStaff,
    kotShowNotes: values.kotShowNotes,
    kotShowPrices: values.kotShowPrices,
    kotShowTotal: values.kotShowTotal,
    kotFontSize: values.kotFontSize,
  };
}

export type KotDesignDraft = SlipDesignDraft<KotTemplate>;

export function useKotDesignDraft(settings: Settings): KotDesignDraft {
  return useSlipDesignDraft(KOT_KIND, settings);
}
