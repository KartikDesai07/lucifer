import { Bell, ChefHat, Gift, type LucideIcon, Palette, Percent, Printer, QrCode, ReceiptText, Store } from "lucide-react";

import type { SettingsSectionSlug } from "@/lib/settings-sections";

// One icon per settings section — hub cards + sidebar sub-menu. Kept out of
// lib/settings-sections.ts so that file stays React/lucide-free (node tests
// import it directly).
export const SETTINGS_SECTION_ICONS: Record<SettingsSectionSlug, LucideIcon> = {
  business: Store,
  taxes: Percent,
  "bill-print": ReceiptText,
  "kitchen-ticket": ChefHat,
  "qr-ordering": QrCode,
  loyalty: Gift,
  appearance: Palette,
  notifications: Bell,
  printing: Printer,
};
