"use client";

import { toast } from "sonner";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintHostDot } from "@/components/layout/print-host-dot-context";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { useDevicePrinter, usePrintLane } from "@/hooks/use-device-printer";
import { useDesktopPrinterName, useSavePrinter } from "@/hooks/use-print-setup";
import { localPrinterConnectionOf, setUpPrintersBody } from "@/lib/print-setup-form";

const EXPLAIN =
  "Slips print as set above. To send each kitchen station's KOTs to its own printer, set up printers: this device's printer becomes Printer 1 and takes every slip, so its paper does not change (other devices' slips print there too). Then add stations and printers.";
const NO_PRINTER_HERE = "Connect this device's printer first (Printer on this device, above).";
const ON_THE_HOST = "Do this on the device that prints all slips today (Where slips print, above).";
const CHECKING = "Checking which device prints today…";
// With no print host, other devices' slips move here (as EXPLAIN says): the toast never says nothing changes.
const DONE_MESSAGE = "Printer 1 is set up. This device's paper does not change, and other devices' slips print here too.";

// Printing redesign, Phase 2 Session 2D (spec §6.6 "Set up printers"): on the device that prints today (the print
// host, or with no host this device), one tap makes Printer 1 from this device's own printer with Bill, Full KOT
// copy, Notices and End of day (plan decision 5: the KOT on paper is today's). Elsewhere it says where to do it, so
// the first printer's device is the one that prints today (it is already the agent: the 2C gate's M-6).
export function SetUpPrintersCard({ deviceId }: { deviceId: string }) {
  // The narrow dot context, never the wide pulse: "none" is no print host; loading or unknown is not known yet.
  const remote = usePrintHostDot();
  const { isHostDevice } = usePrintHostContext();
  const local = useDevicePrinter().printer;
  // The lane, not a render-time shell check: the server and the first paint agree on "pending".
  const lane = usePrintLane();
  const desktopName = useDesktopPrinterName();
  const save = useSavePrinter();
  const here = localPrinterConnectionOf({ local, deviceId, desktop: lane === "desktop" ? { printerName: desktopName } : null, defaultPaper: 80 });
  const known = remote !== "loading" && remote !== "unknown";
  const elsewhere = known && remote !== "none" && !isHostDevice;
  const reason = !known ? CHECKING : elsewhere ? ON_THE_HOST : here === null ? NO_PRINTER_HERE : null;

  const setUp = async () => {
    if (here === null || reason !== null) return;
    try {
      await save.mutateAsync({ body: setUpPrintersBody(here) });
      toast.success(DONE_MESSAGE);
    } catch {
      // The hook toasted it.
    }
  };

  return (
    <div className="space-y-2" data-setup-printers>
      <p className="text-brand-muted">{EXPLAIN}</p>
      <Button className={PRINTER_ACTION_CLASS} disabled={reason !== null || save.isPending} onClick={() => void setUp()}>
        Set up printers
      </Button>
      {reason !== null && <p className="text-xs text-brand-muted">{reason}</p>}
    </div>
  );
}
