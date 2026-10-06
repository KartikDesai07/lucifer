"use client";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { BillPrinterSection } from "@/components/print/BillPrinterSection";
import { PrinterSetupCard } from "@/components/print/PrinterSetupCard";
import { PrinterStatusBanner } from "@/components/print/PrinterStatusBanner";
import { WaitingSlipsCard } from "@/components/print/WaitingSlipsCard";
import { useDotPrinters } from "@/hooks/use-agent-printers";
import { useCanPrintNow, useDesktopPrinterChosen, useDeviceOnline, useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { printerDotOf, printerHeadlineOf, type PrinterDot } from "@/lib/printer/printer-dot";

// Shown while the dot is still unknown (no dot yet): the banner is always on.
const CHECKING_DOT: PrinterDot & { show: true } = { show: true, ok: false, reason: "checking" };

// The printer panel: what the printer is doing right now (the banner), then
// everything to change it (the setup card). One panel in two homes: the top-bar
// sheet (with a Done button) and /printers (inline, no Done). It reads
// the pulse for the printing device's name, which only lives there — the
// deliberate extra reader of the pulse; it mounts only where the panel is open,
// never in the POS screen's render path.
export function PrinterPanel({ onDone }: { onDone?: () => void }) {
  const { pulse } = usePosPulseContext();
  const remote = usePrintHostDot();
  const { isHostDevice, deviceId } = usePrintHostContext();
  const snapshot = useDevicePrinter();
  const lane = usePrintLane();
  const online = useDeviceOnline();
  const desktopChosen = useDesktopPrinterChosen();
  const canPrintHere = useCanPrintNow();
  const dotPrinters = useDotPrinters(deviceId);

  const dot = printerDotOf({ remote, isHostDevice, lane, local: snapshot.status, printers: dotPrinters, deviceOffline: !online, desktopChosen });
  const host = pulse?.printHost ?? null;
  const copy = printerHeadlineOf(dot, {
    hostLabel: host !== null && host.configured ? host.label : null,
    printerName: snapshot.printer?.name ?? null,
    localStatus: snapshot.status,
    isHostDevice,
    canPrintHere,
    desktopNoPrinter: lane === "desktop" && desktopChosen === "none",
  });

  // data-printer-panel scopes the banner's focus targets to THIS panel (the
  // sheet and /printers can both be mounted at once).
  return (
    <div data-printer-panel className="space-y-4">
      <WaitingSlipsCard pulse={pulse} />
      <PrinterStatusBanner dot={dot.show ? dot : CHECKING_DOT} copy={copy} />
      <PrinterSetupCard />
      <BillPrinterSection />
      {onDone !== undefined && (
        <Button className={cn(PRINTER_ACTION_CLASS, "w-full")} onClick={onDone}>
          Done
        </Button>
      )}
    </div>
  );
}
