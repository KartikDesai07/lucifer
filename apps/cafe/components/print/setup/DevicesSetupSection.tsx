"use client";

import { MonitorSmartphone } from "lucide-react";

import type { PrintDeviceShell, PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import { printerWriterDeviceId, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_DOT_BAD_CLASS, PRINTER_DOT_OK_CLASS } from "@/components/print/printer-classes";
import { CAFE_TIMEZONE } from "@/lib/constants";
import { deviceName } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

interface DevicesSetupSectionProps {
  devices: readonly PrintDeviceSummary[];
  printers: readonly PrinterConfig[];
  deviceId: string;
}

const SECTION_DESCRIPTION = "The devices that print, whether they are online, and the printers they print.";
const EMPTY =
  "No device has checked in yet. A device shows here once it prints: the printing device, or a printer's device. To make a tablet a printer's device, open Printer setup on it.";
const SHELL_WORDS: Record<PrintDeviceShell, string> = { android: "POS app (Android)", windows: "Windows app", browser: "Browser" };

function seenAt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: CAFE_TIMEZONE });
}

// Printing redesign, Phase 2 Session 2D (spec §11 Devices): each device that prints or leases, its kind, whether it
// is online (seen within 90 s, the server's verdict) and the printers it prints. Read when the page opens.
export function DevicesSetupSection({ devices, printers, deviceId }: DevicesSetupSectionProps) {
  return (
    <PrinterSection icon={MonitorSmartphone} title="Devices" description={SECTION_DESCRIPTION}>
      {devices.length === 0 && <p className="text-brand-muted">{EMPTY}</p>}
      {devices.map((device) => {
        // Only printers routing sends slips to (the 2D review gate, M-8): switched on and taking a slip.
        const writes = routablePrinters(printers).filter((printer) => printerWriterDeviceId(printer) === device.deviceId).map((printer) => printer.name);
        return (
          <div key={device.deviceId} className="space-y-1 rounded-md border border-brand-rule p-3" data-device-row={device.deviceId}>
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 break-words font-medium text-brand-ink">{deviceName(device.deviceId, devices, deviceId)}</p>
              <span className="flex items-center gap-1.5 text-brand-muted">
                <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", device.online ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_BAD_CLASS)} />
                {device.online ? "Online" : `Offline · seen ${seenAt(device.lastSeenAt)}`}
              </span>
            </div>
            <p className="text-brand-muted">{SHELL_WORDS[device.shell]}</p>
            <p className="text-brand-muted">{writes.length > 0 ? `Prints ${writes.join(", ")}` : "Prints no printer"}</p>
          </div>
        );
      })}
    </PrinterSection>
  );
}
