"use client";

import { useState } from "react";
import { toast } from "sonner";

import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PRINTER_BUTTON_CLASS, PRINTER_BUTTON_REMOVE_CLASS, PRINTER_LABEL_CLASS, PRINTER_NOTE_CLASS } from "@/components/print/printer-classes";
import { NATIVE_TYPE_LABELS } from "@/lib/printer/printer-type-label";
import { PrinterBlock, SetupTestPrint } from "@/components/print/settings/PrinterBlock";
import { Button } from "@/components/ui/button";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useAuth } from "@/hooks/use-auth";
import { useNativePool } from "@/hooks/use-device-printer";
import type { PrinterHere } from "@/lib/print-agent-here";
import { PRINTER_IN_SETUP_MESSAGE, PRINTER_TAKEOVER_MESSAGE, agentPrintersOf } from "@/lib/print-agent-printers";
import { CONNECT_ADD, type ConnectEntry } from "@/lib/printer/connect-flow";
import { PRINTER_CONNECT_FAILED_MESSAGE, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool, type PoolPrinter } from "@/lib/printer/native-pool";
import { blockToneOf, hereEntryOf, otherPrintersNoteOf } from "@/lib/printer/settings-view";

const TITLE = "Other printers on this device";
const RECONNECTED = "Printer connected.";
const REMOVE_FAILED = "Could not remove the printer. Try again.";
const IN_SETUP = PRINTER_IN_SETUP_MESSAGE;
const TAKEOVER = PRINTER_TAKEOVER_MESSAGE;
const STATUS_WORDS: Record<PoolPrinter["status"], string> = { connected: "Connected", connecting: "Connecting…", disconnected: "Not connected" };

// Printing redesign, Phase 2 Session 2F1 (spec §9.2, §11): on the POS app with bridge v2 one phone or tablet drives
// several printers. This device's own printer stays above (it prints every slip in simple mode); here are the app's
// other printers, each with its state, Reconnect and Remove, and Connect another printer (PX-3 Task 11: the guided connect
// in add mode, `onConnect`; a printer chosen there joins the app's printers instead of replacing this device's own; Ruling
// T10b-C: only once this device has its own, `canAdd`). PX-3 Task 10b (spec §6.6 item 2): in printers mode (`card`) they
// are blocks of "Printers on this device", named by the setup, with no title or note of their own (the card's sub says
// it), and an admin's Test print (X5).
export function OtherDevicePrinters({ locked, here, card, canAdd, onConnect }: { locked: boolean; here: readonly PrinterHere[]; card: boolean; canAdd: boolean; onConnect: (entry: ConnectEntry) => void }) {
  const pool = useNativePool();
  const { deviceId } = usePrintHostContext();
  const { printers, answered } = usePrintersRead(deviceId !== "");
  const { isAdmin } = useAuth();
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
  // Simple mode says every slip prints on this device's printer; a printers-mode device that prints nothing, who decides.
  const note = otherPrintersNoteOf(agent.printersMode);
  // Remove only once the setup is known, as the device section (the final Phase 2 gate, m-1: before, every printer looks unnamed).
  const known = deviceId === "" || answered;
  const disabled = locked || busy;

  const settle = async (attempt: Promise<ConnectOutcome>, connected: string, failed: string) => {
    setBusy(true);
    try {
      const outcome = await attempt;
      if (outcome === "connected") toast.success(connected);
      else toast.error(failed);
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

  // Simple mode names the app's other printers only when there are some: with none, the two lines say nothing and cost
  // phone scroll.
  const showNames = !card && others.length > 0;
  const body = (
    <>
      {showNames && <p className={PRINTER_LABEL_CLASS}>{TITLE}</p>}
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
              <div className="flex flex-wrap gap-2">
                {/* Ruling T10b-B: always (a stale "Connected" link is reconnected here), primary while not connected. */}
                <Button className={PRINTER_BUTTON_CLASS} variant={entry.status === "connected" ? "outline" : "default"} disabled={disabled} onClick={() => void settle(nativePool().reconnect(entry.id), RECONNECTED, entry.message ?? PRINTER_CONNECT_FAILED_MESSAGE)}>
                  Reconnect
                </Button>
                {isAdmin && named !== undefined && <SetupTestPrint printer={named} localIds={agent.localIds} disabled={disabled} />}
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
      {showNames && <p className={PRINTER_NOTE_CLASS}>{note}</p>}
      {canAdd && (
        <Button className={PRINTER_BUTTON_CLASS} variant="outline" disabled={disabled} onClick={() => onConnect(CONNECT_ADD)}>
          Connect another printer
        </Button>
      )}
    </>
  );
  // In the card its blocks sit beside this device's own printer (one rule between each); in simple mode, a group of its own.
  return card ? body : <div className="flex flex-col gap-3" data-other-printers>{body}</div>;
}
