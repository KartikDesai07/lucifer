"use client";

import { useState } from "react";
import { Printer, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { PRINTER_BUTTON_CLASS, PRINTER_BUTTON_PRIMARY_CLASS, PRINTER_BUTTON_REMOVE_CLASS, PRINTER_NOTE_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { BrowserPrinterConnect } from "@/components/print/BrowserPrinterConnect";
import { DesktopPrinterPicker } from "@/components/print/DesktopPrinterPicker";
import { NativePrinterPicker } from "@/components/print/NativePrinterPicker";
import { OtherDevicePrinters } from "@/components/print/OtherDevicePrinters";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { PaperSizeToggle } from "@/components/print/PaperSizeToggle";
import { InlineConfirm, PrinterRow } from "@/components/print/PrintHostCardParts";
import { PanelSection } from "@/components/print/PanelSection";
import { PrinterTestTips } from "@/components/print/PrinterTestTips";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useOwnPrinterInSetup } from "@/hooks/use-agent-printers";
import { useDevicePrinter, useNativePool, usePrintCapabilities, usePrintLane } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { TEST_QUESTIONS, useTestPrint } from "@/hooks/use-test-print";
import { printConfigOf } from "@/lib/print";
import { PRINTER_IN_SETUP_MESSAGE } from "@/lib/print-agent-printers";
import { PRINTER_ELSEWHERE_STATUS_MESSAGE, devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool } from "@/lib/printer/native-pool";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";
import { deviceCardTitleOf } from "@/lib/printer/settings-view";
import { nativeTargetId, type NativeSelectTarget } from "@/lib/printer/transport-native";

const REMOVED_MESSAGE = "Printer removed from this device.";
const REMOVE_FAILED_MESSAGE = "Could not remove the printer. Try again.";
const NO_CAPABILITY_MESSAGE =
  "This browser or app cannot connect to a printer directly. For direct printing, use Chrome or Edge, or the new POS app.";
// Spec §9.7 (Phase 2 Session 2E): a browser tab drives one printer, and a hidden tab's timers are slowed.
const KEEP_TAB_OPEN = "Keep this tab open, or use the POS app: a hidden or closed tab prints late or not at all.";
const TEST_BUSY_REASON = "Busy with another slip. Try again in a moment.";

// "This device's printer" (PX-3 Task 10, spec §6.6 item 1; mockup t-settings; was "Printer on this device" and the Test print
// card): which way slips leave THIS device, by what it can do. The desktop app has its own picker; the POS app lists
// printers it can see; a browser connects Bluetooth or USB straight from a tap. The row, then Test print · Change · Remove,
// then Paper width. No Reconnect (X7): the status card's Reconnect is the fix. Everything but the test (its own gate) is
// disabled while one action runs, and while another tab of this browser owns the printer.
export function DevicePrinterSection({ noun }: { noun: DeviceNoun }) {
  const lane = usePrintLane();
  const caps = usePrintCapabilities();
  const snapshot = useDevicePrinter();
  const settings = useSettings();
  const paperDefault = printConfigOf(settings.data).bill.paperWidth;
  const test = useTestPrint();
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // The FIRST list (paired / USB) was closed without a pick: say what to do next.
  const [notSeen, setNotSeen] = useState(false);
  const { printer, status } = snapshot;
  const elsewhere = status === "elsewhere";
  const locked = busy || elsewhere;
  const { deviceId } = usePrintHostContext();
  const { inSetup, known } = useOwnPrinterInSetup(deviceId);
  const pool = useNativePool();
  // The 2F2 review gate (M-4): Change printer of a printer the setup prints through this device keeps it in the POS app
  // (bridge v2): a new printer is added first (one the app lists already is only chosen: an add would restart its link),
  // then made this device's printer, and the old one stays among the app's other printers; also while the setup is not
  // known yet (its review, m-F: a setup printer dropped there would wait; one kept costs a Remove). Anywhere else it is
  // replaced, as before.
  const listed = (target: NativeSelectTarget) => pool.printers.some((entry) => entry.id.toLowerCase() === nativeTargetId(target).toLowerCase());
  const keepInApp = pool.active && (inSetup || !known) ? async (target: NativeSelectTarget) => {
    if (!listed(target)) await nativePool().add(target);
    return devicePrinter().selectNative(target, paperDefault);
  } : undefined;

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

  // The test slip, only where it proves something (the printing device, or a printer of this device; on the Windows app
  // the printing device's attestation), then its one question, the tips after "No — help me", and why it waits.
  const testButton = test.testable && (
    <Button className={PRINTER_BUTTON_CLASS} variant="outline" onClick={() => void test.start()} disabled={test.startDisabled}>
      <ReceiptText aria-hidden="true" />
      {test.phase === "printing" ? "Printing…" : "Test print"}
    </Button>
  );
  const asked = test.raster ? TEST_QUESTIONS.raster : TEST_QUESTIONS.window;
  const testAnswer = (
    <>
      {test.phase === "confirm" && (
        <InlineConfirm question={asked.question} yes="Yes" no={asked.no} disabled={test.attesting} onYes={() => void test.answer(true)} onNo={() => void test.answer(false)} />
      )}
      {test.deviceBusy && <p className={PRINTER_NOTE_CLASS}>{TEST_BUSY_REASON}</p>}
      {test.tips && <PrinterTestTips />}
    </>
  );

  return (
    <PanelSection
      icon={<Printer />}
      title={deviceCardTitleOf(lane)}
      data-printer-target="device"
      tabIndex={-1}
    >
      {lane === "desktop" ? (
        <>
          <DesktopPrinterPicker />
          {testButton}
          {testAnswer}
        </>
      ) : lane === "pending" ? null : (
        <>
          {elsewhere && <p role="status" className="text-status-warn-ink">{PRINTER_ELSEWHERE_STATUS_MESSAGE}</p>}
          {printer !== null && (
            <>
              <PrinterRow printer={printer} status={status} />
              {printer.kind !== "native" && <p className={PRINTER_NOTE_CLASS}>{KEEP_TAB_OPEN}</p>}
              {snapshot.message !== null && !elsewhere && <p role="status" className="text-muted-foreground">{snapshot.message}</p>}
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
                // Sized to their words, one row that wraps on a narrow phone.
                <div className="flex flex-wrap gap-2">
                  {testButton}
                  <Button
                    className={PRINTER_BUTTON_CLASS}
                    variant="outline"
                    onClick={() => {
                      setChanging((v) => !v);
                      setNotSeen(false);
                    }}
                    disabled={locked}
                  >
                    {changing ? "Keep this printer" : "Change"}
                  </Button>
                  {inSetup ? (
                    <p className={PRINTER_NOTE_CLASS}>{PRINTER_IN_SETUP_MESSAGE}</p>
                  ) : known ? (
                    <Button className={PRINTER_BUTTON_REMOVE_CLASS} variant="outline" onClick={() => setConfirmRemove(true)} disabled={locked}>
                      Remove
                    </Button>
                  ) : null}
                </div>
              )}
              {testAnswer}
              <PaperSizeToggle value={printer.paper} disabled={locked} onChange={(paper) => devicePrinter().setPaper(paper)} />
            </>
          )}
          {/* The app with no printer: the line and one way in (Task 11 turns it into the guided connect). */}
          {printer === null && caps.native && (
            <>
              <p>{`No printer on ${noun}.`}</p>
              {!changing && (
                <Button className={PRINTER_BUTTON_PRIMARY_CLASS} onClick={() => setChanging(true)} disabled={locked}>
                  Connect a printer
                </Button>
              )}
            </>
          )}
          {caps.native && changing && <NativePrinterPicker paper={paperDefault} busy={locked} onAttempt={settle} add={keepInApp} />}
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
          {choosing && !caps.native && !caps.serial && !caps.bluetooth && <p className="text-muted-foreground">{NO_CAPABILITY_MESSAGE}</p>}
          {/* The printing device with no printer of its own (a print window): its test stays reachable. */}
          {printer === null && testButton}
          {printer === null && testAnswer}
          {/* Phase 2 Session 2F1 (spec §9.2): the POS app on bridge v2 drives more printers beside this device's own. */}
          {caps.native && <OtherDevicePrinters paper={paperDefault} locked={locked} />}
        </>
      )}
    </PanelSection>
  );
}
