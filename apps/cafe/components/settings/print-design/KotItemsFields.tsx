"use client";

import { ToggleRow } from "@/components/settings/SettingsFields";
import { KOT_ITEMS_PRICES_DESCRIPTION, KOT_ITEMS_PRICES_LABEL } from "@/lib/print-design-labels";

interface KotItemsFieldsProps {
  prices: boolean;
  onPrices: (prices: boolean) => void;
}

// The kitchen ticket's Items line has one option of its own: the price beside each dish. Options and notes on a
// dish always print, so there is nothing else to switch here.
export function KotItemsFields({ prices, onPrices }: KotItemsFieldsProps) {
  return <ToggleRow label={KOT_ITEMS_PRICES_LABEL} description={KOT_ITEMS_PRICES_DESCRIPTION} checked={prices} onChange={onPrices} />;
}
