"use client";

import { useState } from "react";
import { Printer as PrinterIcon } from "lucide-react";
import { toast } from "sonner";

import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_ACTION_CLASS, PRINTER_DOT_BAD_CLASS, PRINTER_DOT_OK_CLASS } from "@/components/print/printer-classes";
import { PrinterFormDialog } from "@/components/print/setup/PrinterFormDialog";
import { SetUpPrintersCard } from "@/components/print/setup/SetUpPrintersCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useDesktopPrinters } from "@/hooks/use-agent-printers";
import { useCanPrintNow, useDevicePrinter } from "@/hooks/use-device-printer";
import { usePoolView } from "@/hooks/use-agent-printers";
import { useDeletePrinter, useSavePrinter, useTestPrinter } from "@/hooks/use-print-setup";
import { agentPrintersOf, readyPrinterIdsOf } from "@/lib/print-agent-printers";
import { printerStatusOf } from "@/lib/printer/printer-registry";
import { printerBodyOf, printerDraftOf } from "@/lib/print-setup-form";
import { connectionText, printerFailoverLines, printerRowState, setupGaps, slipsText, testPrintBlock, testPrintSentText } from "@/lib/print-setup-text";
import { cn } from "@/lib/utils";

interface PrintersSetupSectionProps {
  printers: readonly PrinterConfig[];
  stations: readonly StationConfig[];
  devices: readonly PrintDeviceSummary[];
  /** The devices read failed (the 2E review gate, M-3): a remote printer's row says its device is unknown. */
  devicesFailed: boolean;
  deviceId: string;
}

const SECTION_DESCRIPTION = "Each printer, the slips it prints and the device that prints it.";

// Printing redesign, Phase 2 Session 2D (spec §11 Printers): every printer with its dot in words (its printing
// device's heartbeat, or this device's own printer), its connection, slips, paper and copies; switch it on or off,
// test it, edit it, delete it. With no printer yet, "Set up printers" comes first (a printer added before it
// would switch the whole cafe to printers mode with only that printer, spec §6.6).
export function PrintersSetupSection({ printers, stations, devices, devicesFailed, deviceId }: PrintersSetupSectionProps) {
  const [form, setForm] = useState<{ key: string; printer: PrinterConfig | null } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  // The 2D review gate (M-5): switching a printer off fails its waiting slips, so it asks first, as Delete does.
  const [switchingOff, setSwitchingOff] = useState<string | null>(null);
  const save = useSavePrinter();
  const remove = useDeletePrinter();
  const testPrint = useTestPrinter();
  // The printers this device prints here, from the list this page already holds (no second read, no subscription).
  const local = useDevicePrinter().printer;
  const desktop = useDesktopPrinters();
  const pool = usePoolView();
  const here = agentPrintersOf(printers, deviceId, local, desktop, pool);
  const localIds = here.localIds;
  // Session 2F1 (spec §9.2): each printer of the POS app by its own state; any other while this device's printer can print.
  const readyIds = readyPrinterIdsOf(localIds, here.targets, useCanPrintNow(), printerStatusOf);
  const gaps = setupGaps(printers, stations);
  const busy = save.isPending || remove.isPending;

  const toggle = async (printer: PrinterConfig) => {
    setSwitchingOff(null);
    const result = printerBodyOf({ ...printerDraftOf(printer, stations), enabled: !printer.enabled }, printers, printer.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    try {
      await save.mutateAsync({ id: printer.id, body: result.body });
    } catch {
      // The hook toasted it.
    }
  };

  const test = async (printer: PrinterConfig, state: ReturnType<typeof printerRowState>) => {
    try {
      await testPrint.mutateAsync(printer.id);
      toast.success(testPrintSentText(printer, state));
    } catch {
      // The hook toasted it.
    }
  };

  const confirmDelete = async (printer: PrinterConfig) => {
    setDeleting(null);
    try {
      await remove.mutateAsync(printer.id);
      toast.success(`${printer.name} deleted.`);
    } catch {
      // The hook toasted it.
    }
  };

  return (
    <PrinterSection icon={PrinterIcon} title="Printers" description={SECTION_DESCRIPTION}>
      {printers.length === 0 ? (
        <SetUpPrintersCard deviceId={deviceId} />
      ) : (
        <>
          {gaps.map((gap) => (
            <p key={gap} role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
              {gap}
            </p>
          ))}
          {printers.map((printer) => {
            const canPrint = readyIds.includes(printer.id);
            // The 2F1 review gate (M-2): one of the POS app's printers has a state of its own, so its words name it.
            const ownState = here.targets[printer.id]?.nativeId !== undefined;
            const state = printerRowState(printer, devices, { deviceId, localIds, canPrint, devicesFailed, ownState });
            const blocked = testPrintBlock(printer, printers, { deviceId, localIds, canPrint, ownState });
            return (
              <div key={printer.id} className="space-y-2 rounded-md border border-brand-rule p-3" data-printer-row={printer.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 break-words font-medium text-brand-ink">{printer.name}</p>
                  <span className="flex items-center gap-1.5 text-brand-muted">
                    <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-full", state.tone === "ok" ? PRINTER_DOT_OK_CLASS : state.tone === "bad" ? PRINTER_DOT_BAD_CLASS : "bg-gray-400")} />
                    {state.text}
                  </span>
                  <Switch
                    aria-label={`${printer.name} on`}
                    checked={printer.enabled}
                    disabled={busy}
                    onCheckedChange={() => (printer.enabled ? setSwitchingOff(printer.id) : void toggle(printer))}
                  />
                </div>
                <p className="text-brand-muted">{connectionText(printer, devices, deviceId)}</p>
                <p className="text-brand-muted">{slipsText(printer, stations)}</p>
                <p className="text-brand-muted">
                  Paper {printer.paper} mm · KOT copies {printer.copies.kot} · Bill copies {printer.copies.bill}
                </p>
                {/* Session 3B (spec §9.3, §9.4, §10): its backup, who prints it now, its problem, no takeover. */}
                {printerFailoverLines(printer, printers, devices, deviceId, Date.now()).map((line) => (
                  <p key={line} className="text-brand-muted">
                    {line}
                  </p>
                ))}
                {switchingOff === printer.id ? (
                  <InlineConfirm
                    question={`Switch ${printer.name} off? Slips still waiting for it will show under Couldn't print.`}
                    yes="Yes, switch off"
                    no="No"
                    disabled={busy}
                    onYes={() => void toggle(printer)}
                    onNo={() => setSwitchingOff(null)}
                  />
                ) : deleting === printer.id ? (
                  <InlineConfirm
                    question={`Delete ${printer.name}? Slips still waiting for it will show under Couldn't print.`}
                    yes="Yes, delete"
                    no="No"
                    disabled={busy}
                    onYes={() => void confirmDelete(printer)}
                    onNo={() => setDeleting(null)}
                  />
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={blocked !== null || testPrint.isPending} onClick={() => void test(printer, state)}>
                      Test print
                    </Button>
                    <Button variant="outline" className={PRINTER_ACTION_CLASS} onClick={() => setForm({ key: printer.id, printer })}>
                      Edit
                    </Button>
                    <Button variant="outline" className={PRINTER_ACTION_CLASS} disabled={busy} onClick={() => setDeleting(printer.id)}>
                      Delete
                    </Button>
                  </div>
                )}
                {blocked !== null && <p className="text-xs text-brand-muted">{blocked}</p>}
              </div>
            );
          })}
          <Button className={PRINTER_ACTION_CLASS} onClick={() => setForm({ key: "new", printer: null })}>
            Add printer
          </Button>
        </>
      )}
      {form !== null && (
        <PrinterFormDialog key={form.key} printer={form.printer} printers={printers} stations={stations} devices={devices} deviceId={deviceId} onClose={() => setForm(null)} />
      )}
    </PrinterSection>
  );
}
