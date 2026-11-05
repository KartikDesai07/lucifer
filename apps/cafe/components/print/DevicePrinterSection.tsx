"use client";

import { useState } from "react";
import { Printer, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { PRINTER_BUTTON_CLASS, PRINTER_BUTTON_PRIMARY_CLASS, PRINTER_BUTTON_REMOVE_CLASS, PRINTER_NOTE_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { BrowserPrinterConnect } from "@/components/print/BrowserPrinterConnect";
import { DesktopPrinterPicker } from "@/components/print/DesktopPrinterPicker";
import { OtherDevicePrinters } from "@/components/print/OtherDevicePrinters";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { PaperSizeToggle } from "@/components/print/PaperSizeToggle";
import { InlineConfirm, PrinterRow, STATUS_LABEL } from "@/components/print/PrintHostCardParts";
import { PanelSection } from "@/components/print/PanelSection";
import { PrinterTestTips } from "@/components/print/PrinterTestTips";
import { PrinterBlock, SetupTestPrint } from "@/components/print/settings/PrinterBlock";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { useDotPrinters, useOwnPrinterInSetup } from "@/hooks/use-agent-printers";
import { useAuth } from "@/hooks/use-auth";
import { useDevicePrinter, useNativePool, usePrintCapabilities, usePrintLane } from "@/hooks/use-device-printer";
import { useSettings } from "@/hooks/use-settings";
import { TEST_QUESTIONS, useTestPrint } from "@/hooks/use-test-print";
import { printConfigOf } from "@/lib/print";
import { PRINTER_IN_SETUP_MESSAGE } from "@/lib/print-agent-printers";
import { CONNECT_REPLACE, type ConnectEntry } from "@/lib/printer/connect-flow";
import { PRINTER_ELSEWHERE_STATUS_MESSAGE, devicePrinter, type ConnectOutcome } from "@/lib/printer/device-printer";
import type { DeviceNoun } from "@/lib/printer/printer-status-view";
import { PRINTERS_CARD, blockToneOf, deviceCardTitleOf, hereEntryOf, printerSubOf, settingsNameOf } from "@/lib/printer/settings-view";

const REMOVED_MESSAGE = "Printer removed from this device.";
const REMOVE_FAILED_MESSAGE = "Could not remove the printer. Try again.";
const NO_CAPABILITY_MESSAGE =
  "This browser or app cannot connect to a printer directly. For direct printing, use Chrome or Edge, or the new POS app.";
// Spec §9.7 (Phase 2 Session 2E): a browser tab drives one printer, and a hidden tab's timers are slowed.
const KEEP_TAB_OPEN = "Keep this tab open, or use the POS app: a hidden or closed tab prints late or not at all.";
const TEST_BUSY_REASON = "Busy with another slip. Try again in a moment.";

// "This device's printer" (PX-3 Task 10, spec §6.6 item 1; mockup t-settings; was "Printer on this device" and the Test print
// card): which way slips leave THIS device, by what it can do. The desktop app has its own picker; the POS app connects
// through the guided connect; a browser connects Bluetooth or USB straight from a tap. The row, then Test print · Change · Remove,
// then Paper width. No Reconnect (X7): the status card's Reconnect is the fix. Everything but the test (its own gate) is
// disabled while one action runs, and while another tab of this browser owns the printer.
// Task 10b (spec §6.6 item 2; mockup t-settings-pm): on a printers-mode writer it is "Printers on this device", one card for
// every printer this device prints: its own printer first by the setup's name (today's Reconnect; on the app's pool no
// Change: the manager names its printers in Printer setup), then the app's other printers as blocks of the same card.
// Task 11 (X2, spec §6.7): in the Android app Connect a printer and Change open the guided connect (onConnect: the
// panel's connect view; hooks/use-connect-attempt.ts keeps a printer the setup prints here in the app); a browser keeps
// its chooser here.
export function DevicePrinterSection({ noun, onConnect }: { noun: DeviceNoun; onConnect: (entry: ConnectEntry) => void }) {
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
  // The printers read already cached (no request of its own). The Windows app keeps its picker in either mode (X2).
  const dot = useDotPrinters(deviceId);
  const { isAdmin } = useAuth();
  const printersCard = lane !== "desktop" && dot.printersMode && dot.isWriter;
  const here = dot.here ?? [];
  // This device's own printer in `here`: on bridge v2 the app's default, else the one printer with no app id.
  const ownId = pool.active ? (pool.defaultId ?? null) : null;
  const ownHere = printersCard ? hereEntryOf(here, ownId) : undefined;
  // X5: an admin tests a printer the setup names through the setup's own test; anyone else, today's device test. `here`
  // is every printer this device prints now (the agent's local printers, as the dot counts them).
  const ownSetupTest = isAdmin && ownHere !== undefined ? <SetupTestPrint printer={ownHere} localIds={here.map((entry) => entry.id)} disabled={locked} /> : null;

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

  // This device's printer's lines and buttons: under its row in simple mode, inside its block in printers mode.
  const ownLines = printer !== null && (
    <>
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
          {/* T10b-B: today's Reconnect in printers mode (PX-2's stuck step sends staff here); simple mode's is the status card's. */}
          {printersCard && (
            <Button className={PRINTER_BUTTON_CLASS} variant={status === "connected" ? "outline" : "default"} onClick={() => void settle(devicePrinter().reconnect())} disabled={locked}>
              Reconnect
            </Button>
          )}
          {ownSetupTest ?? testButton}
          {/* T10b-C: no Change on the app's pool (the manager names those); a browser's or bridge v1's printer keeps it. */}
          {(!printersCard || !pool.active) && (
            <Button
              className={PRINTER_BUTTON_CLASS}
              variant="outline"
              onClick={() => {
                if (caps.native) return onConnect(CONNECT_REPLACE);
                setChanging((v) => !v);
                setNotSeen(false);
              }}
              disabled={locked}
            >
              {changing ? "Keep this printer" : "Change"}
            </Button>
          )}
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
      {/* Every mode: the device test draws at this paper, and the row's sub says it. */}
      <PaperSizeToggle value={printer.paper} disabled={locked} onChange={(paper) => devicePrinter().setPaper(paper)} />
    </>
  );

  return (
    <PanelSection
      icon={<Printer />}
      title={printersCard ? PRINTERS_CARD.title : deviceCardTitleOf(lane)}
      sub={printersCard ? PRINTERS_CARD.sub : undefined}
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
          {printer !== null &&
            (printersCard ? (
              <PrinterBlock name={settingsNameOf(here, ownId) ?? printer.name} sub={printerSubOf(printer)} tone={blockToneOf(status)} word={STATUS_LABEL[status]}>
                {ownLines}
              </PrinterBlock>
            ) : (
              <>
                <PrinterRow printer={printer} status={status} />
                {ownLines}
              </>
            ))}
          {/* The app with no printer: the line and one way in, the guided connect. */}
          {printer === null && caps.native && (
            <>
              <p>{`No printer on ${noun}.`}</p>
              <Button className={PRINTER_BUTTON_PRIMARY_CLASS} onClick={() => onConnect(CONNECT_REPLACE)} disabled={locked}>
                Connect a printer
              </Button>
            </>
          )}
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
          {/* Phase 2 Session 2F1 (spec §9.2): the POS app on bridge v2 drives more printers beside this device's own;
              printers mode: as blocks of this card (Task 10b); Connect another printer: the guided connect's add (Task 11). */}
          {caps.native && <OtherDevicePrinters locked={locked} here={here} card={printersCard} canAdd={printer !== null} onConnect={onConnect} />}
        </>
      )}
    </PanelSection>
  );
}
