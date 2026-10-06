"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { sampleKitchenOrder, sampleKitchenSlip, withSampleToken } from "@/lib/bill-print-sample";
import { printConfigOf } from "@/lib/print";
import {
  KITCHEN_CHIP_LABEL,
  KITCHEN_CHIP_LEGEND,
  KITCHEN_PREVIEW_CHIPS,
  type KitchenPreviewChip,
} from "@/lib/print-design-labels";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { SlipPreview } from "@/components/print/slip/SlipSkeleton";
import { ChoiceChips } from "@/components/settings/print-design/ChoiceChips";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// Every field the Kitchen ticket page edits, as ONE list (the section's own
// field list in lib/settings-sections.ts). The sample ticket below is the REAL
// kitchen renderer over a real order, so it follows the form the moment one of
// these changes. A field added to the page but missing here would silently stop
// updating the preview — lib/kitchen-ticket-preview-paths.test.ts pins that the
// two sets are equal.
const WATCHED_KOT_FIELDS = [
  "kotShowPrices",
  "kotShowTotal",
  "kotShowNumber",
  "kotNumberStart",
  "kotNumberVoidSlips",
  "kotShowLogo",
  "kotShowRestaurantName",
  "kotShowTable",
  "kotShowStaff",
  "kotShowTime",
  "kotShowNotes",
  "kotPaperWidth",
  "kotFontSize",
] as const;

export function KitchenTicketPreview({
  control,
  settings,
}: {
  control: Control<SettingsInput>;
  settings: Settings;
}) {
  const [
    kotShowPrices,
    kotShowTotal,
    kotShowNumber,
    kotNumberStart,
    kotNumberVoidSlips,
    kotShowLogo,
    kotShowRestaurantName,
    kotShowTable,
    kotShowStaff,
    kotShowTime,
    kotShowNotes,
    kotPaperWidth,
    kotFontSize,
  ] = useWatch({ control, name: WATCHED_KOT_FIELDS });

  // The saved settings with the form's unsaved ticket fields laid over them.
  const live: Settings = {
    ...settings,
    kotShowPrices,
    kotShowTotal,
    kotShowNumber,
    kotNumberStart,
    kotNumberVoidSlips,
    kotShowLogo,
    kotShowRestaurantName,
    kotShowTable,
    kotShowStaff,
    kotShowTime,
    kotShowNotes,
    kotPaperWidth,
    kotFontSize,
  };
  const cfg = printConfigOf(live).kot;
  // Fixed once per mount so the sample's time does not tick while editing.
  const [createdAt] = useState(() => new Date().toISOString());
  const order = withSampleToken(sampleKitchenOrder(createdAt), live);
  // Which of the kitchen's three tickets the sample shows (not a setting; nothing here is ever saved).
  const [chip, setChip] = useState<KitchenPreviewChip>("kot");
  const slip = sampleKitchenSlip(chip, order, cfg);

  return (
    <div className="space-y-3">
      <ChoiceChips
        legend="Show the ticket for"
        options={KITCHEN_PREVIEW_CHIPS}
        value={chip}
        onChange={setChip}
        labelOf={(value) => KITCHEN_CHIP_LABEL[value]}
        hint={KITCHEN_CHIP_LEGEND}
      />
      <div className="overflow-x-auto">
        <div className="mx-auto w-fit shadow-sm ring-1 ring-black/5">
          <SlipPreview>
            <KOTReceipt order={order} settings={live} {...slip} />
          </SlipPreview>
        </div>
      </div>
    </div>
  );
}
