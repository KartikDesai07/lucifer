"use client";

import { useState } from "react";
import { toast } from "sonner";

import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { NativePrinterPicker } from "@/components/print/NativePrinterPicker";
import { PRINTER_ACTION_CLASS, PRINTER_DOT_BAD_CLASS, PRINTER_DOT_OK_CLASS } from "@/components/print/printer-classes";
import { NATIVE_TYPE_LABELS } from "@/components/print/printer-type";
import { Button } from "@/components/ui/button";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { usePrintersRead } from "@/hooks/use-agent-printers";
import { useNativePool } from "@/hooks/use-device-printer";
import type { PaperWidth } from "@/lib/constants";
import { PRINTER_IN_SETUP_MESSAGE, agentPrintersOf } from "@/lib/print-agent-printers";
import { PRINTER_CONNECT_FAILED_MESSAGE, type ConnectOutcome } from "@/lib/printer/device-printer";
import { nativePool, type PoolPrinter } from "@/lib/printer/native-pool";
import { cn } from "@/lib/utils";

const TITLE = "Other printers on this device";
const NOTE = "Each one prints the slips Printer setup gives it: Add printer, then Device printer.";
const ADDED = "Printer added to this device.";
const RECONNECTED = "Printer connected.";
const NOT_YET = "The printer is added, but not connected yet. Check it is on, then tap Reconnect.";
const REMOVE_FAILED = "Could not remove the printer. Try again.";
const IN_SETUP = PRINTER_IN_SETUP_MESSAGE;
const STATUS_WORDS: Record<PoolPrinter["status"], string> = { connected: "Connected", connecting: "Connecting…", disconnected: "Not connected" };

// Printing redesign, Phase 2 Session 2F1 (spec §9.2, §11): on the POS app with bridge v2 one phone or tablet drives
// several printers. This device's own printer stays above (it prints every slip in simple mode); here are the app's
// other printers, each with its state, Reconnect and Remove, and Add another printer (the same list the app shows for
// the first one; a printer chosen here joins the app's printers instead of replacing this device's own).
export function OtherDevicePrinters({ paper, locked }: { paper: PaperWidth; locked: boolean }) {
  const pool = useNativePool();
  const { deviceId } = usePrintHostContext();
  const { printers, answered } = usePrintersRead(deviceId !== "");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  if (!pool.active) return null;
  // The app's own default is this device's printer, shown above (the 2E gate's review, M-6: by the app's word).
  const others = pool.printers.filter((entry) => entry.id !== pool.defaultId);
  // A printer the setup names this device for is added back by itself (a network printer), so it is not removed here
  // (the 2E gate's review, I-3): the words say where to change it.
  const inSetup = new Set(Object.values(agentPrintersOf(printers, deviceId, null, null, pool).targets).flatMap((target) => (target.nativeId === undefined ? [] : [target.nativeId])));
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

  return (
    <div className="space-y-3" data-other-printers>
      <p className="font-medium text-brand-ink">{TITLE}</p>
      {others.map((entry) => (
        <div key={entry.id} className="space-y-2 rounded-md border border-brand-rule p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 break-words font-medium text-brand-ink">
              {entry.printer.name} · {NATIVE_TYPE_LABELS[entry.printer.transport]}
              {entry.printer.transport === "tcp" ? ` ${entry.id.slice("tcp:".length)}` : ""}
            </p>
            <span className="flex items-center gap-1.5 text-brand-muted">
              <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", entry.status === "connected" ? PRINTER_DOT_OK_CLASS : PRINTER_DOT_BAD_CLASS)} />
              {STATUS_WORDS[entry.status]}
            </span>
          </div>
          {entry.message !== null && <p role="status" className="text-brand-muted">{entry.message}</p>}
          {removing === entry.id ? (
            <InlineConfirm question={`Remove ${entry.printer.name} from this device?`} yes="Yes, remove" no="No" disabled={disabled} onYes={() => void remove(entry.id)} onNo={() => setRemoving(null)} />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button className={PRINTER_ACTION_CLASS} variant={entry.status === "connected" ? "outline" : "default"} disabled={disabled} onClick={() => void settle(nativePool().reconnect(entry.id), RECONNECTED, entry.message ?? PRINTER_CONNECT_FAILED_MESSAGE)}>
                Reconnect
              </Button>
              {inSetup.has(entry.id) ? (
                <p className="text-xs text-brand-muted">{IN_SETUP}</p>
              ) : known ? (
                <Button className={PRINTER_ACTION_CLASS} variant="outline" disabled={disabled} onClick={() => setRemoving(entry.id)}>
                  Remove
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ))}
      <p className="text-xs text-brand-muted">{NOTE}</p>
      <Button className={PRINTER_ACTION_CLASS} variant="outline" disabled={disabled} onClick={() => setAdding((open) => !open)}>
        {adding ? "Close the printer list" : "Add another printer"}
      </Button>
      {adding && <NativePrinterPicker paper={paper} busy={disabled} onAttempt={(attempt) => settle(attempt, ADDED, NOT_YET)} add={(target) => nativePool().add(target)} />}
    </div>
  );
}
