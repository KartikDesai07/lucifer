"use client";

import { useState } from "react";
import { toast } from "sonner";

import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { NativePrinterPicker } from "@/components/print/NativePrinterPicker";
import { PRINTER_BUTTON_CLASS, PRINTER_BUTTON_REMOVE_CLASS, PRINTER_DEVICE_BUTTONS_CLASS, PRINTER_LABEL_CLASS, PRINTER_NOTE_CLASS } from "@/components/print/printer-classes";
import { NATIVE_TYPE_LABELS } from "@/components/print/printer-type";
import { PrinterBlock, SetupTestPrint } from "@/components/print/settings/PrinterBlock";
import { Button } from "@/components/ui/button";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useAuth } from "@/hooks/use-auth";
import { useNativePool } from "@/hooks/use-device-printer";
import type { PaperWidth } from "@/lib/constants";
import type { PrinterHere } from "@/lib/print-agent-here";
import { PRINTER_IN_SETUP_MESSAGE, PRINTER_TAKEOVER_MESSAGE, agentPrintersOf } from "@/lib/print-agent-printers";
import { PRINTER_CONNECT_FAILED_MESSAGE, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool, type PoolPrinter } from "@/lib/printer/native-pool";
import { PRINTERS_CARD, blockToneOf, hereEntryOf } from "@/lib/printer/settings-view";

const TITLE = "Other printers on this device";
const NOTE = PRINTERS_CARD.sub;
const ADDED = "Printer added to this device.";
const RECONNECTED = "Printer connected.";
const NOT_YET = "The printer is added, but not connected yet. Check it is on, then tap Reconnect.";
const REMOVE_FAILED = "Could not remove the printer. Try again.";
const IN_SETUP = PRINTER_IN_SETUP_MESSAGE;
const TAKEOVER = PRINTER_TAKEOVER_MESSAGE;
const STATUS_WORDS: Record<PoolPrinter["status"], string> = { connected: "Connected", connecting: "Connecting…", disconnected: "Not connected" };

// Printing redesign, Phase 2 Session 2F1 (spec §9.2, §11): on the POS app with bridge v2 one phone or tablet drives
// several printers. This device's own printer stays above (it prints every slip in simple mode); here are the app's
// other printers, each with its state, Reconnect while it is not connected, and Remove, and Connect another printer (the
// same list the app shows for the first one; a printer chosen here joins the app's printers instead of replacing this
// device's own). PX-3 Task 10b (spec §6.6 item 2): in printers mode (`card`) they are blocks of "Printers on this device",
// named by the setup, with no title or note of their own (the card's sub says it), and an admin's Test print (X5).
export function OtherDevicePrinters({ paper, locked, here, card }: { paper: PaperWidth; locked: boolean; here: readonly PrinterHere[]; card: boolean }) {
  const pool = useNativePool();
  const { deviceId } = usePrintHostContext();
  const { printers, answered } = usePrintersRead(deviceId !== "");
  const { isAdmin } = useAuth();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!pool.active) return null;
  // The app's own default is this device's printer, shown above (the 2E gate's review, M-6: by the app's word).
  const others = pool.printers.filter((entry) => entry.id !== pool.defaultId);
  // A printer the setup names this device for is added back by itself (a network printer), so it is not removed here
  // (the 2E gate's review, I-3): the words say where to change it.
  // Session 3B: a network printer this device may take over is added back by itself too; its words say why it stays.
  const agent = agentPrintersOf(printers, deviceId, null, null, pool);
  const appIds = (ids: readonly string[]) => new Set(ids.flatMap((id) => agent.targets[id]?.nativeId ?? []));
  const inSetup = appIds(agent.localIds.filter((id) => !agent.takeoverIds.includes(id)));
  const takeover = appIds(agent.takeoverIds);
  // Remove only once the setup is known, as the device section (the final Phase 2 gate, m-1: before, every printer looks unnamed).
  const known = deviceId === "" || answered;
  const disabled = locked || busy;

  const settle = async (attempt: Promise<ConnectOutcome>, connected: string, failed: string) => {
    setBusy(true);
    try {
      const outcome = await attempt;
      if (outcome === "connected") toast.success(connected);
      else toast.error(failed);
      setAdding(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : PRINTER_CONNECT_FAILED_MESSAGE);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setRemoving(null);
    setBusy(true);
    try {
      await nativePool().remove(id);
    } catch {
      toast.error(REMOVE_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      {!card && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}
      {others.map((entry) => {
        // The setup's printer this app printer is (printers mode): its name, and the admin's test of it.
        const named = hereEntryOf(here, entry.id);
        const sub = `${entry.printer.name} · ${NATIVE_TYPE_LABELS[entry.printer.transport]}${entry.printer.transport === "tcp" ? ` ${entry.id.slice("tcp:".length)}` : ""}`;
        return (
          <PrinterBlock key={entry.id} name={named?.name ?? entry.printer.name} sub={sub} tone={blockToneOf(entry.status)} word={STATUS_WORDS[entry.status]}>
            {entry.message !== null && <p role="status" className="text-muted-foreground">{entry.message}</p>}
            {removing === entry.id ? (
              <InlineConfirm question={`Remove ${entry.printer.name} from this device?`} yes="Yes, remove" no="No" disabled={disabled} onYes={() => void remove(entry.id)} onNo={() => setRemoving(null)} />
            ) : (
              <div className={PRINTER_DEVICE_BUTTONS_CLASS}>
                {entry.status !== "connected" && (
                  <Button className={PRINTER_BUTTON_CLASS} variant="outline" disabled={disabled} onClick={() => void settle(nativePool().reconnect(entry.id), RECONNECTED, entry.message ?? PRINTER_CONNECT_FAILED_MESSAGE)}>
                    Reconnect
                  </Button>
                )}
                {isAdmin && named !== undefined && <SetupTestPrint printer={named} disabled={disabled} />}
                {inSetup.has(entry.id) ? (
                  <p className={PRINTER_NOTE_CLASS}>{IN_SETUP}</p>
                ) : takeover.has(entry.id) ? (
                  <p className={PRINTER_NOTE_CLASS}>{TAKEOVER}</p>
                ) : known ? (
                  <Button className={PRINTER_BUTTON_REMOVE_CLASS} variant="outline" disabled={disabled} onClick={() => setRemoving(entry.id)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            )}
          </PrinterBlock>
        );
      })}
      {!card && <p className={PRINTER_NOTE_CLASS}>{NOTE}</p>}
      <Button className={PRINTER_BUTTON_CLASS} variant="outline" disabled={disabled} onClick={() => setAdding((open) => !open)}>
        {adding ? "Close the printer list" : "Connect another printer"}
      </Button>
      {adding && <NativePrinterPicker paper={paper} busy={disabled} onAttempt={(attempt) => settle(attempt, ADDED, NOT_YET)} add={(target) => nativePool().add(target)} />}
    </>
  );
  // In the card its blocks sit beside this device's own printer (one rule between each); in simple mode, a group of its own.
  return card ? body : <div className="flex flex-col gap-3" data-other-printers>{body}</div>;
}
