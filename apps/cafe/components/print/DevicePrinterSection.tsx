"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { DesktopPrinterPicker } from "@/components/print/DesktopPrinterPicker";
import { NativePrinterPicker } from "@/components/print/NativePrinterPicker";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { PaperSizeToggle } from "@/components/print/PaperSizeToggle";
import { InlineConfirm, PrinterRow } from "@/components/print/PrintHostCardParts";
import { useDevicePrinter, usePrintCapabilities, usePrintLane } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { printConfigOf } from "@/lib/print";
import { PRINTER_ELSEWHERE_STATUS_MESSAGE, devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";

const REMOVED_MESSAGE = "Printer removed from this device.";
const REMOVE_FAILED_MESSAGE = "Could not remove the printer. Try again.";
const NO_CAPABILITY_MESSAGE =
  "This browser or app cannot connect to a printer directly. For direct printing, use Chrome or Edge, or the new POS app.";
const BLUETOOTH_HELP = "Printers paired in this device's Bluetooth settings, or a USB printer on a PC.";
const BLUETOOTH_LE_HELP = "Small Bluetooth printers that do not show up in the first list.";
const BUTTON_CLASS = cn(PRINTER_ACTION_CLASS, "w-full sm:w-auto");

// "Printer on this device": which way slips leave THIS device, by what it can
// do. The desktop app has its own picker; the POS app lists printers it can
// see; a browser connects Bluetooth or USB straight from a tap. Everything is
// disabled while one action runs, and while another tab of this browser owns
// the printer.
export function DevicePrinterSection() {
  const lane = usePrintLane();
  const caps = usePrintCapabilities();
  const snapshot = useDevicePrinter();
  const settings = useSettings();
  const paperDefault = printConfigOf(settings.data).bill.paperWidth;
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { printer, status } = snapshot;
  const elsewhere = status === "elsewhere";
  const locked = busy || elsewhere;

  // The attempt is STARTED by the click handler (its chooser is the first
  // await, which needs the tap's user activation); this only waits for it.
  const settle = async (attempt: Promise<ConnectOutcome>) => {
    setBusy(true);
    try {
      if ((await toastConnectOutcome(attempt)) === "connected") setChanging(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    setBusy(true);
    try {
      await devicePrinter().forget();
      setChanging(false);
      toast.success(REMOVED_MESSAGE);
    } catch {
      toast.error(REMOVE_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const choosing = printer === null || changing;
  const webChoices = caps.serial || caps.bluetooth;

  return (
    <section data-printer-target="device" tabIndex={-1} className={`${BRAND_PANEL_CLASS} space-y-3 rounded-lg border p-4 text-sm`}>
      <h3 className="text-base font-semibold text-brand-ink">Printer on this device</h3>
      {lane === "desktop" ? (
        <DesktopPrinterPicker />
      ) : lane === "pending" ? null : (
        <>
          {elsewhere && <p role="status" className="text-amber-700">{PRINTER_ELSEWHERE_STATUS_MESSAGE}</p>}
          {printer !== null && (
            <div className="space-y-3">
              <PrinterRow printer={printer} status={status} />
              {snapshot.message !== null && !elsewhere && <p role="status" className="text-brand-muted">{snapshot.message}</p>}
              {confirmRemove ? (
                <InlineConfirm
                  question={`Remove ${printer.name} from this device?`}
                  yes="Yes, remove"
                  no="No"
                  disabled={locked}
                  onYes={() => void remove()}
                  onNo={() => setConfirmRemove(false)}
                />
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button className={BUTTON_CLASS} onClick={() => void settle(devicePrinter().reconnect())} disabled={locked}>
                    Reconnect
                  </Button>
                  <Button className={BUTTON_CLASS} variant="outline" onClick={() => setChanging((v) => !v)} disabled={locked}>
                    {changing ? "Keep this printer" : "Change printer"}
                  </Button>
                  <Button className={BUTTON_CLASS} variant="outline" onClick={() => setConfirmRemove(true)} disabled={locked}>
                    Remove
                  </Button>
                </div>
              )}
              <PaperSizeToggle value={printer.paper} disabled={locked} onChange={(paper) => devicePrinter().setPaper(paper)} />
            </div>
          )}
          {choosing && caps.native && <NativePrinterPicker paper={paperDefault} busy={locked} onAttempt={settle} />}
          {choosing && !caps.native && webChoices && (
            <div className="space-y-3">
              {caps.serial && (
                <div className="space-y-1">
                  <Button className={BUTTON_CLASS} onClick={() => void settle(devicePrinter().connectNew("serial", paperDefault))} disabled={locked}>
                    Bluetooth printer
                  </Button>
                  <p className="text-xs text-brand-muted">{BLUETOOTH_HELP}</p>
                </div>
              )}
              {caps.bluetooth && (
                <div className="space-y-1">
                  <Button className={BUTTON_CLASS} variant="outline" onClick={() => void settle(devicePrinter().connectNew("ble", paperDefault))} disabled={locked}>
                    Bluetooth LE printer
                  </Button>
                  <p className="text-xs text-brand-muted">{BLUETOOTH_LE_HELP}</p>
                </div>
              )}
            </div>
          )}
          {choosing && !caps.native && !webChoices && <p className="text-brand-muted">{NO_CAPABILITY_MESSAGE}</p>}
        </>
      )}
    </section>
  );
}
