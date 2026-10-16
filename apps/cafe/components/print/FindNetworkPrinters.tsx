"use client";

// Printing Phase 4 (spec 2026-10-15 §7.3): "Find network printers" beside a network printer's address. Only where this
// device's app can scan; up to about 10 s; then the printers found, each marked when the setup or this device's POS app
// already has it. A tap only fills the address and port: staff go on exactly as today (Use or Save, then Test print).
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";

import type { PrinterConfig } from "@pos/shared/print-printers";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PRINTERS_KEYS } from "@/hooks/use-agent-printers";
import { useNativePool } from "@/hooks/use-device-printer";
import {
  FIND_NETWORK_PRINTERS_LABEL,
  LAN_NONE_FOUND_MESSAGE,
  LAN_NO_NETWORK_MESSAGE,
  LAN_SCANNING_MESSAGE,
  alreadyAddedText,
  knownLanPrinters,
  lanFoundRows,
  lanScanAvailable,
  scanNetworkPrinters,
  type LanScanOutcome,
} from "@/lib/printer/lan-discovery";

interface FindNetworkPrintersProps {
  /** Fills the form's address and port with the printer tapped. */
  onPick: (host: string, port: number) => void;
  disabled?: boolean;
}

const NO_SETUP_PRINTERS: PrinterConfig[] = [];

export function FindNetworkPrinters({ onPick, disabled = false }: FindNetworkPrintersProps) {
  const qc = useQueryClient();
  const pool = useNativePool();
  const [scanning, setScanning] = useState(false);
  const [outcome, setOutcome] = useState<LanScanOutcome | null>(null);

  if (!lanScanAvailable()) return null;

  const find = async () => {
    setScanning(true);
    setOutcome(null);
    const outcome = await scanNetworkPrinters();
    setOutcome(outcome);
    setScanning(false);
  };

  // The setup's printers as the page's cache already holds them (Session 4D's review, m-B): no query observer of its own,
  // so opening a form never refetches the printers list.
  const setup = qc.getQueryData<PrinterConfig[]>(PRINTERS_KEYS.all) ?? NO_SETUP_PRINTERS;
  const known = knownLanPrinters(setup, pool.printers.map((printer) => ({ id: printer.id, name: printer.printer.name })));
  const rows = outcome?.kind === "found" ? lanFoundRows(outcome.printers, known) : [];
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className={PRINTER_ACTION_CLASS} disabled={disabled || scanning} onClick={() => void find()}>
        {scanning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Search className="mr-2 h-4 w-4" aria-hidden />}
        {FIND_NETWORK_PRINTERS_LABEL}
      </Button>
      {scanning && <p role="status" className="text-xs text-brand-muted">{LAN_SCANNING_MESSAGE}</p>}
      {outcome?.kind === "none" && <p role="status" className="text-xs text-brand-muted">{LAN_NONE_FOUND_MESSAGE}</p>}
      {outcome?.kind === "no-network" && <p role="status" className="text-xs text-brand-muted">{LAN_NO_NETWORK_MESSAGE}</p>}
      {rows.length > 0 && (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={`${row.host}:${row.port}`}>
              <Button type="button" variant="ghost" className={cn(PRINTER_ACTION_CLASS, "h-auto min-h-11 w-full flex-col items-start justify-center")} disabled={disabled} onClick={() => onPick(row.host, row.port)}>
                <span className="text-sm text-brand-ink">{row.label}</span>
                {row.alreadyAdded !== null && <span className="text-xs text-brand-muted">{alreadyAddedText(row.alreadyAdded)}</span>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
