"use client";

import { useState } from "react";
import { useWatch } from "react-hook-form";
import type { Control } from "react-hook-form";

import { sampleKitchenOrder } from "@/lib/bill-print-sample";
import { printConfigOf } from "@/lib/print";
import { ROUND_LABEL_PREFIX } from "@/lib/print-host-slips";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
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
  const order = sampleKitchenOrder(createdAt);

  // A normal ticket is a fired round, which always carries its round line.
  const roundLabel = `${ROUND_LABEL_PREFIX}${order.kotRounds}`;

  return (
    <div className="overflow-x-auto">
      <div className="mx-auto w-fit shadow-sm ring-1 ring-black/5">
        <KOTReceipt order={order} settings={live} roundNumber={cfg.numberStart} roundLabel={roundLabel} />
      </div>
    </div>
  );
}
