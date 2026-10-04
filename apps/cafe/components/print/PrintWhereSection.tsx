"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, MonitorSmartphone } from "lucide-react";

import { PRINTER_ACTION_CLASS, PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PrinterSection } from "@/components/print/PrinterSection";
import type { PrintHostState } from "@pos/shared/print-job";

// Mirrors PRINT_HOST_LABEL_MAX_CHARS, which lives in the server-only
// lib/print-host.ts (it imports a Mongoose model, so it cannot be imported
// into a client component).
const LABEL_MAX_CHARS = 60;
const OFFLINE_MESSAGE = "This device is offline. Where slips print will show here when it is back online.";
const CHECKING_MESSAGE = "Checking where slips print…";
const SECTION_DESCRIPTION = "Choose which device prints your slips.";
const ONE_DEVICE_TITLE = "Use one device for all printing";
const ONE_DEVICE_HELP = "Good for a Counter PC with the printer: orders from phones print there.";
const PRINTERS_MODE_LINE = "Printers are set up: each slip prints at its printer (Printer setup → Printers).";

export interface PrintWhereSectionProps {
  /** `null` = unresolved pulse OR a degraded tick — never "no printing device". */
  host: PrintHostState | null;
  /** The configured printing device's name; null when none is set. */
  hostLabel: string | null;
  isHostDevice: boolean;
  /** THIS device has a network connection (PR3: offline reads as a status line, never "loading"). */
  online: boolean;
  label: string;
  onLabelChange: (label: string) => void;
  onDesignate: () => void;
  designating: boolean;
  /** The remove-the-printing-device control, shown here only while this device is the one. */
  stopControl: ReactNode;
  /** Phase 2 Session 2D: printers are set up (spec §6.6), so no printing device plays a part. */
  printersMode?: boolean;
}

// Which device prints the slips: this one, another one, or each device its own.
export function PrintWhereSection(props: PrintWhereSectionProps) {
  const { host, hostLabel, isHostDevice, online, label, onLabelChange, onDesignate, designating, stopControl, printersMode } = props;
  const [confirmMove, setConfirmMove] = useState(false);
  const anotherOnline = hostLabel !== null && host !== null && !host.offline;

  const designateButton = (text: string, onClick: () => void) => (
    <Button data-action="designate" variant="outline" className={cn(PRINTER_ACTION_CLASS, "w-full sm:w-auto")} onClick={onClick} disabled={designating}>
      {designating ? "Saving…" : text}
    </Button>
  );

  return (
    <PrinterSection id="printer-where" icon={MonitorSmartphone} title="Where slips print" description={SECTION_DESCRIPTION}>
      {printersMode === true ? (
        // In printers mode a printing device decides nothing: the words say so, and a former printing device can
        // still stop (removing every printer brings it back, spec §6.6).
        <>
          <p>{PRINTERS_MODE_LINE}</p>
          {stopControl}
        </>
      ) : isHostDevice ? (
        <>
          <p className="flex items-center gap-2 font-medium text-brand-ink">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-700" aria-hidden="true" />
            This device prints all slips.
          </p>
          {stopControl}
        </>
      ) : host === null ? (
        <p role="status" className="text-brand-muted">{online ? CHECKING_MESSAGE : OFFLINE_MESSAGE}</p>
      ) : hostLabel !== null ? (
        <>
          <p>All slips print at {hostLabel}.</p>
          {confirmMove ? (
            <InlineConfirm
              question={`${hostLabel} is printing now. Move printing to this device?`}
              yes="Yes, move"
              no="No"
              disabled={designating}
              onYes={() => {
                setConfirmMove(false);
                onDesignate();
              }}
              onNo={() => setConfirmMove(false)}
            />
          ) : (
            designateButton("Print on this device instead", () => (anotherOnline ? setConfirmMove(true) : onDesignate()))
          )}
        </>
      ) : (
        <div className="space-y-3">
          <p>Each device prints its own slips.</p>
          <div className="space-y-2 rounded-md border border-brand-rule p-3">
            <p className="font-medium text-brand-ink">{ONE_DEVICE_TITLE}</p>
            <p className="text-xs text-brand-muted">{ONE_DEVICE_HELP}</p>
            <label className="block space-y-1">
              <span className="text-[13px] font-medium text-brand-ink">Name for this device</span>
              <Input
                value={label}
                maxLength={LABEL_MAX_CHARS}
                onChange={(e) => onLabelChange(e.target.value)}
                className={cn(PRINTER_INPUT_CLASS, "max-w-sm")}
              />
            </label>
            {designateButton("Print all slips on this device", onDesignate)}
          </div>
        </div>
      )}
    </PrinterSection>
  );
}
