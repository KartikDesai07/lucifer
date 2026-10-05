"use client";

import { useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { BrowserPrinterConnect } from "@/components/print/BrowserPrinterConnect";
import { DesktopPrinterPicker } from "@/components/print/DesktopPrinterPicker";
import { NativePrinterPicker } from "@/components/print/NativePrinterPicker";
import { OtherDevicePrinters } from "@/components/print/OtherDevicePrinters";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { PaperSizeToggle } from "@/components/print/PaperSizeToggle";
import { InlineConfirm, PrinterRow } from "@/components/print/PrintHostCardParts";
import { PrinterSection } from "@/components/print/PrinterSection";
import { useDevicePrinter, usePrintCapabilities, usePrintLane } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { printConfigOf } from "@/lib/print";
import { PRINTER_ELSEWHERE_STATUS_MESSAGE, devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";

const REMOVED_MESSAGE = "Printer removed from this device.";
const REMOVE_FAILED_MESSAGE = "Could not remove the printer. Try again.";
const NO_CAPABILITY_MESSAGE =
  "This browser or app cannot connect to a printer directly. For direct printing, use Chrome or Edge, or the new POS app.";
const SECTION_DESCRIPTION = "The printer this device prints on.";
// Spec §9.7 (Phase 2 Session 2E): a browser tab drives one printer, and a hidden tab's timers are slowed.
const KEEP_TAB_OPEN = "Keep this tab open, or use the POS app: a hidden or closed tab prints late or not at all.";

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
  // The FIRST list (paired / USB) was closed without a pick: say what to do next.
  const [notSeen, setNotSeen] = useState(false);
  const { printer, status } = snapshot;
  const elsewhere = status === "elsewhere";
  const locked = busy || elsewhere;

  // The attempt is STARTED by the click handler (its chooser is the first
  // await, which needs the tap's user activation); this only waits for it.
  // A closed FIRST list raises the hint; a connect clears it. A closed nearby search leaves it as it
  // was (both lists closed: the advice still stands), and so does a failure (its own toast speaks).
  const settle = async (attempt: Promise<ConnectOutcome>, firstList = false) => {
    setBusy(true);
    try {
      const outcome = await toastConnectOutcome(attempt);
      if (outcome === "connected") {
        setChanging(false);
        setNotSeen(false);
      } else if (firstList && outcome === "cancelled") {
        setNotSeen(true);
      }
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
      setNotSeen(false);
      toast.success(REMOVED_MESSAGE);
    } catch {
      toast.error(REMOVE_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const choosing = printer === null || changing;
  // Serial first: it lists printers PAIRED over Bluetooth, and USB ones on a PC.
  const primaryKind = caps.serial ? "serial" : "ble";
  const connected = status === "connected";

  return (
    <PrinterSection
      icon={Printer}
      title="Printer on this device"
      description={SECTION_DESCRIPTION}
      data-printer-target="device"
      tabIndex={-1}
    >
      {lane === "desktop" ? (
        <DesktopPrinterPicker />
      ) : lane === "pending" ? null : (
        <>
          {elsewhere && <p role="status" className="text-amber-700">{PRINTER_ELSEWHERE_STATUS_MESSAGE}</p>}
          {printer !== null && (
            <div className="space-y-3">
              <PrinterRow printer={printer} status={status} />
              {printer.kind !== "native" && <p className="text-xs text-brand-muted">{KEEP_TAB_OPEN}</p>}
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
                // Sized to their words, so on a phone Reconnect and Change printer share a line.
                <div className="flex flex-wrap gap-2">
                  <Button
                    className={PRINTER_ACTION_CLASS}
                    variant={connected ? "outline" : "default"}
                    onClick={() => void settle(devicePrinter().reconnect())}
                    disabled={locked}
                  >
                    Reconnect
                  </Button>
                  <Button
                    className={PRINTER_ACTION_CLASS}
                    variant="outline"
                    onClick={() => {
                      setChanging((v) => !v);
                      setNotSeen(false);
                    }}
                    disabled={locked}
                  >
                    {changing ? "Keep this printer" : "Change printer"}
                  </Button>
                  <Button className={PRINTER_ACTION_CLASS} variant="outline" onClick={() => setConfirmRemove(true)} disabled={locked}>
                    Remove
                  </Button>
                </div>
              )}
              <PaperSizeToggle value={printer.paper} disabled={locked} onChange={(paper) => devicePrinter().setPaper(paper)} />
            </div>
          )}
          {choosing && caps.native && <NativePrinterPicker paper={paperDefault} busy={locked} onAttempt={settle} />}
          {choosing && !caps.native && (caps.serial || caps.bluetooth) && (
            <BrowserPrinterConnect
              paired={caps.serial}
              nearby={caps.serial && caps.bluetooth}
              locked={locked}
              notSeen={notSeen}
              onConnect={() => void settle(devicePrinter().connectNew(primaryKind, paperDefault), true)}
              onSearchNearby={() => void settle(devicePrinter().connectNew("ble", paperDefault))}
            />
          )}
          {choosing && !caps.native && !caps.serial && !caps.bluetooth && <p className="text-brand-muted">{NO_CAPABILITY_MESSAGE}</p>}
          {/* Phase 2 Session 2F1 (spec §9.2): the POS app on bridge v2 drives more printers beside this device's own. */}
          {caps.native && <OtherDevicePrinters paper={paperDefault} locked={locked} />}
        </>
      )}
    </PrinterSection>
  );
}
