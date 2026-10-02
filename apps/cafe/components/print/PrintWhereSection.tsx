"use client";

import { useState, type ReactNode } from "react";

import { PRINTER_ACTION_CLASS, PRINTER_INPUT_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import type { PrintHostState } from "@pos/shared/print-job";

// Mirrors PRINT_HOST_LABEL_MAX_CHARS, which lives in the server-only
// lib/print-host.ts (it imports a Mongoose model, so it cannot be imported
// into a client component).
const LABEL_MAX_CHARS = 60;
const OFFLINE_MESSAGE = "This device is offline. Where slips print will show here when it is back online.";
const CHECKING_MESSAGE = "Checking where slips print…";

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
}

// Which device prints the slips: this one, another one, or each device its own.
export function PrintWhereSection(props: PrintWhereSectionProps) {
  const { host, hostLabel, isHostDevice, online, label, onLabelChange, onDesignate, designating, stopControl } = props;
  const [confirmMove, setConfirmMove] = useState(false);
  const anotherOnline = hostLabel !== null && host !== null && !host.offline;

  const designateButton = (text: string, onClick: () => void) => (
    <Button data-action="designate" className={PRINTER_ACTION_CLASS} onClick={onClick} disabled={designating}>
      {designating ? "Saving…" : text}
    </Button>
  );

  return (
    <section id="printer-where" className={`${BRAND_PANEL_CLASS} space-y-3 rounded-lg border p-4 text-sm`}>
      <h3 className="text-base font-semibold text-brand-ink">Where slips print</h3>
      {isHostDevice ? (
        <>
          <p>This device prints all slips.</p>
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
        <div className="space-y-2">
          <p>Each device prints its own slips.</p>
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
          <p className="text-xs text-brand-muted">Every slip from every device will print here.</p>
        </div>
      )}
    </section>
  );
}
