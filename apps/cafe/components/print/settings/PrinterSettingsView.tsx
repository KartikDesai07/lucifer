"use client";

import { BillPrinterSection } from "@/components/print/BillPrinterSection";
import { DevicePrinterSection } from "@/components/print/DevicePrinterSection";
import { TextKotSection } from "@/components/print/TextKotSection";
import { MoreCard } from "@/components/print/settings/MoreCard";
import { PrintForOthersCard } from "@/components/print/settings/PrintForOthersCard";
import type { ConnectEntry } from "@/lib/printer/connect-flow";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";

// The printer panel's SETTINGS view (Printer UX PX-3 Task 10, spec §6.6; mockups t-settings / t-host): the setup as cards, in
// §6.6's order: this device's printer, printing for other devices, Faster KOTs, the bill printer (printers mode), More.
// Each card reads its own state and draws nothing where it does not apply. home: the sheet or /printers (More's Printer
// setup row is the sheet's only); onClose: the sheet's own close, so that row can leave the sheet first; onConnect: the
// Android app's guided connect (Task 11), for the device card's Connect a printer, Change and Connect another printer.
export function PrinterSettingsView({ home, noun, onClose, onConnect }: { home: "sheet" | "page"; noun: DeviceNoun; onClose?: () => void; onConnect: (entry: ConnectEntry) => void }) {
  return (
    <>
      <DevicePrinterSection noun={noun} onConnect={onConnect} />
      <PrintForOthersCard />
      <TextKotSection />
      <BillPrinterSection />
      <MoreCard home={home} onClose={onClose} />
    </>
  );
}
