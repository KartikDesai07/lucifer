"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { PrintDeviceSummary } from "@pos/shared/print-agent-wire";
import type { PrinterConfig, StationConfig } from "@pos/shared/print-printers";
import { BRAND_CHECKBOX_SQUARE_CLASS } from "@/components/brand/brand-classes";
import { PRINTER_ACTION_CLASS, PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BackupPrinterSelect } from "@/components/print/setup/BackupPrinterSelect";
import { NativePrinterSelect } from "@/components/print/setup/NativePrinterSelect";
import { WindowsPrinterSelect } from "@/components/print/setup/WindowsPrinterSelect";
import { useDevicePrinter, useNativePool, usePrintCapabilities } from "@/hooks/use-device-printer";
import { useDesktopPrinterChoices, useSavePrinter } from "@/hooks/use-print-setup";
import { useSettings } from "@/hooks/use-settings";
import { desktopPrintsOnNamed } from "@/lib/desktop-shell-printer";
import { printConfigOf } from "@/lib/print";
import { nativeIdOf } from "@/lib/print-agent-printers";
import { PRINTER_WINDOWS_REQUIRED, appPrinterConnectionOf, draftWithLocal, lanPrintingDevicesOf, localPrinterConnectionOf, onePrinterDevicesOf, printerBodyOf, printerDraftOf, printerPaperOf, windowsPrinterConnectionOf, type PrinterDraft } from "@/lib/print-setup-form";
import { deviceConnectionText, deviceName } from "@/lib/print-setup-text";
import { desktopLanApi } from "@/lib/printer/desktop-lan";

interface PrinterFormDialogProps {
  /** null: Add printer. */
  printer: PrinterConfig | null;
  printers: readonly PrinterConfig[];
  stations: readonly StationConfig[];
  devices: readonly PrintDeviceSummary[];
  deviceId: string;
  onClose: () => void;
}

const LAN_TIP = "Give the printer a fixed address (a static IP, or a DHCP reservation on the router) so it never moves.";
const LAN_DEVICE_NOTE =
  "The POS app on an Android phone or tablet, or the Windows app 1.12 or later on a PC, prints to a network printer. A device not listed here (a PC that prints nothing yet, say): open Printer setup on it and add the printer there.";
const FULL_COPY_NOTE = "A full copy already holds every station's items.";
const NOTICES_NOTE = "Void, moved and cancel slips for the stations it prints.";
const COPIES = ["1", "2", "3"];
const ONE_WINDOWS_PRINTER = "This Windows app prints one printer, the one chosen for this PC. Install the Windows app 1.11 or later to print several printers here.";
const ONE_APP_PRINTER = "This POS app prints one printer, the one on this device. Update the POS app to print several printers here.";

// Printing redesign, Phase 2 Session 2D (spec §11 Add printer): one printer saved whole. 1. the connection: a
// network printer and the Android app device that prints it, or a printer only its own device reaches (taken from
// this device's printer, never typed, so the agent recognises it); 2. its slips; 3. paper and copies. Mounted only
// while open (keyed by the printer), so its draft starts fresh every time.
export function PrinterFormDialog({ printer, printers, stations, devices, deviceId, onClose }: PrinterFormDialogProps) {
  const save = useSavePrinter();
  const local = useDevicePrinter().printer;
  const caps = usePrintCapabilities();
  const desktop = useDesktopPrinterChoices();
  const paper = printerPaperOf(printConfigOf(useSettings().data).kot.paperWidth);
  const [draft, setDraft] = useState<PrinterDraft>(() => (printer === null ? { ...printerDraftOf(null, stations), paper } : printerDraftOf(printer, stations)));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<PrinterDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const here = localPrinterConnectionOf({ local, deviceId, desktop: desktop === null ? null : { printerName: desktop.selected }, defaultPaper: paper });
  // Session 2E (spec §9.2): on a Windows app that prints on a named printer, this PC's printer is one of its Windows
  // printers, chosen by name; a printer of another device keeps its saved connection.
  const named = desktop !== null && desktopPrintsOnNamed();
  const windowsHere = named && (draft.device === null || (draft.device.transport === "windows" && draft.device.deviceId === deviceId));
  // Phase 2 Session 2F1 (spec §9.2): on the POS app with bridge v2 a printer of this device is one of the app's printers.
  const pool = useNativePool();
  const appHere = pool.active && draft.kind === "device" && (draft.device === null || draft.device.deviceId === deviceId);
  const appChoice = draft.device === null ? "" : (nativeIdOf({ connection: draft.device }, pool) ?? "");
  const onePrinter = onePrinterDevicesOf(devices, { deviceId, native: caps.native, v2: pool.active });
  // Phase 3 Session 3E (spec §9.6): a Windows app 1.12.0 prints network printers too, this PC or another.
  const choices = lanPrintingDevicesOf(devices, { deviceId, lan: caps.native || desktopLanApi() !== null }, draft.primaryDeviceId);
  const shownDevice = draft.device === null ? null : `${deviceConnectionText(draft.device, devices, deviceId)} (${draft.device.address})`;

  const submit = async () => {
    const result = printerBodyOf(draft, printers, printer?.id, windowsHere ? PRINTER_WINDOWS_REQUIRED : undefined, onePrinter);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({ id: printer?.id, body: result.body });
      onClose();
    } catch {
      // The hook toasted the server's words; the form stays open to fix them.
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{printer === null ? "Add printer" : `Edit ${printer.name}`}</DialogTitle>
          <DialogDescription>Where it is, which slips it prints, and its paper.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <div className="space-y-1">
            <Label htmlFor="printer-name">Name</Label>
            <Input id="printer-name" className={PRINTER_INPUT_CLASS} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Kitchen printer" />
          </div>
          <div className="space-y-2">
            <p className="font-medium">1. Connection</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={draft.kind === "lan" ? "default" : "outline"} className={PRINTER_ACTION_CLASS} onClick={() => set({ kind: "lan" })}>
                Network (LAN)
              </Button>
              <Button type="button" variant={draft.kind === "device" ? "default" : "outline"} className={PRINTER_ACTION_CLASS} onClick={() => set({ kind: "device" })}>
                Device printer
              </Button>
              {here !== null && !named && !pool.active && (
                <Button type="button" variant="outline" className={PRINTER_ACTION_CLASS} onClick={() => setDraft((current) => draftWithLocal(current, here))}>
                  Use this device&apos;s printer
                </Button>
              )}
            </div>
            {draft.kind === "lan" ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <Input aria-label="Printer address" className={`${PRINTER_INPUT_CLASS} col-span-2`} value={draft.host} onChange={(e) => set({ host: e.target.value })} placeholder="192.168.1.60" />
                  <Input aria-label="Port" className={PRINTER_INPUT_CLASS} inputMode="numeric" value={draft.port} onChange={(e) => set({ port: e.target.value })} />
                </div>
                <p className="text-xs text-brand-muted">{LAN_TIP}</p>
                <Select value={draft.primaryDeviceId} onValueChange={(value) => set({ primaryDeviceId: value })}>
                  <SelectTrigger aria-label="Printing device" className={PRINTER_INPUT_CLASS}>
                    <SelectValue placeholder="Choose the device that prints it" />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((id) => (
                      <SelectItem key={id} value={id}>
                        {deviceName(id, devices, deviceId)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-brand-muted">{LAN_DEVICE_NOTE}</p>
              </div>
            ) : windowsHere ? (
              <WindowsPrinterSelect
                names={desktop?.names ?? null}
                value={draft.device?.address ?? ""}
                onChange={(name) => setDraft((current) => draftWithLocal(current, windowsPrinterConnectionOf(deviceId, name, current.paper)))}
              />
            ) : appHere ? (
              <NativePrinterSelect
                printers={pool.printers}
                value={appChoice}
                onChange={(id) => {
                  const chosen = pool.printers.find((entry) => entry.id === id);
                  const local = chosen === undefined ? null : appPrinterConnectionOf(chosen.printer, deviceId, draft.paper);
                  if (local !== null) setDraft((current) => draftWithLocal(current, local));
                }}
              />
            ) : (
              <p className="text-brand-muted">{shownDevice ?? "Connect a printer on this device (Printer on this device, above), then tap Use this device's printer."}</p>
            )}
            {desktop !== null && !named && <p className="text-xs text-brand-muted">{ONE_WINDOWS_PRINTER}</p>}
            {caps.native && !pool.active && <p className="text-xs text-brand-muted">{ONE_APP_PRINTER}</p>}
          </div>
          <div className="space-y-2">
            <p className="font-medium">2. Slips</p>
            <Tick label="Bill" checked={draft.bill} onChange={(bill) => set({ bill })} />
            <Tick label="Full KOT copy" checked={draft.kotAll} onChange={(kotAll) => set({ kotAll, ...(kotAll ? { kotStations: [] } : {}) })} />
            {stations.map((station) => (
              <Tick
                key={station.id}
                label={`${station.name} KOTs`}
                checked={!draft.kotAll && draft.kotStations.includes(station.id)}
                disabled={draft.kotAll}
                onChange={(on) => set({ kotStations: on ? [...draft.kotStations, station.id] : draft.kotStations.filter((id) => id !== station.id) })}
              />
            ))}
            {draft.kotAll && <p className="text-xs text-brand-muted">{FULL_COPY_NOTE}</p>}
            <Tick label="Notices" hint={NOTICES_NOTE} checked={draft.notices} onChange={(notices) => set({ notices })} />
            <Tick label="End of day" checked={draft.eod} onChange={(eod) => set({ eod })} />
          </div>
          <div className="space-y-2">
            <p className="font-medium">3. Paper and copies</p>
            <div className="flex flex-wrap gap-2">
              {([58, 80] as const).map((paper) => (
                <Button key={paper} type="button" variant={draft.paper === paper ? "default" : "outline"} className={PRINTER_ACTION_CLASS} onClick={() => set({ paper })}>
                  {paper} mm
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Copies label="KOT copies" value={draft.copiesKot} onChange={(copiesKot) => set({ copiesKot })} />
              <Copies label="Bill copies" value={draft.copiesBill} onChange={(copiesBill) => set({ copiesBill })} />
            </div>
          </div>
          <div className="space-y-2">
            <p className="font-medium">4. Backup printer</p>
            <BackupPrinterSelect printerId={printer?.id ?? null} value={draft.backupPrinterId} printers={printers} onChange={(backupPrinterId) => set({ backupPrinterId })} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-md border border-brand-rule p-3">
            <span className="font-medium">Printer on</span>
            <Switch aria-label="Printer on" checked={draft.enabled} onCheckedChange={(enabled) => set({ enabled })} />
          </label>
          {error !== null && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button className={PRINTER_ACTION_CLASS} onClick={() => void submit()} disabled={save.isPending}>
            {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save printer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Tick({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <Checkbox className={BRAND_CHECKBOX_SQUARE_CLASS} checked={checked} disabled={disabled} onCheckedChange={(state) => onChange(state === true)} />
      <span>
        {label}
        {hint !== undefined && <span className="block text-xs text-brand-muted">{hint}</span>}
      </span>
    </label>
  );
}

function Copies({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))}>
      <SelectTrigger aria-label={label} className={PRINTER_INPUT_CLASS}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COPIES.map((n) => (
          <SelectItem key={n} value={n}>
            {label}: {n}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
