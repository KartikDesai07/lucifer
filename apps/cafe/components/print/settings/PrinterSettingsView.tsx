"use client";

import { BillPrinterSection } from "@/components/print/BillPrinterSection";
import { DevicePrinterSection } from "@/components/print/DevicePrinterSection";
import { TextKotSection } from "@/components/print/TextKotSection";
import { MoreCard } from "@/components/print/settings/MoreCard";
import { PrintForOthersCard } from "@/components/print/settings/PrintForOthersCard";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";

// The printer panel's SETTINGS view (Printer UX PX-3 Task 10, spec §6.6; mockups t-settings / t-host): the setup as cards, in
// §6.6's order: this device's printer, printing for other devices, Faster KOTs, the bill printer (printers mode), More.
// Each card reads its own state and draws nothing where it does not apply. home: the sheet or /printers (More's Printer
// setup row is the sheet's only); onClose: the sheet's own close, so that row can leave the sheet first.
export function PrinterSettingsView({ home, noun, onClose }: { home: "sheet" | "page"; noun: DeviceNoun; onClose?: () => void }) {
  return (
    <>
      <DevicePrinterSection noun={noun} />
      <PrintForOthersCard />
      <TextKotSection />
      <BillPrinterSection />
      <MoreCard home={home} onClose={onClose} />
    </>
  );
}
