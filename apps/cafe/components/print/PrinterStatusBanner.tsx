"use client";

import { useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { PRINTER_ELSEWHERE_MESSAGE, devicePrinter } from "@/lib/printer/device-printer";
import type { PrinterDot, PrinterFix, PrinterHeadline } from "@/lib/printer/printer-dot";
import {
  PRINTER_BUTTON_SMALL_CLASS,
  PRINTER_STATUS_CARD_CLASS,
  PRINTER_STATUS_CIRCLE_CLASS,
  PRINTER_STATUS_DETAIL_CLASS,
  PRINTER_STATUS_HEAD_CLASS,
  PRINTER_STATUS_LOOK,
  PRINTER_TILE_BAD_CLASS,
  PRINTER_TILE_NEUTRAL_CLASS,
  PRINTER_TILE_OK_CLASS,
} from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";

// The panel's status card (the HTML's, values 17): a 34px circle, one headline, one sentence, and at most
// ONE button that fixes the problem. role=status so a screen reader hears a change;
// the circle is decoration — the words carry the meaning. "Checking" is a spinner
// on a neutral circle: it is neither good nor bad yet.
const FIX_LABEL: Record<PrinterFix, string> = {
  reconnect: "Reconnect",
  setup: "Set up printing",
  "print-here": "Print on this device",
};
const RECONNECTING_LABEL = "Reconnecting…";
const PANEL_SELECTOR = "[data-printer-panel]";
const DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]';
const DESIGNATE_SELECTOR = '[data-action="designate"]';

// The HTML's "!" stroke (values 17), drawn by hand: lucide's circled alerts would put a ring inside the circle.
function Bang({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M12 8v5M12 16.5h.01" />
    </svg>
  );
}

// The circle's glyph and tone follow the dot; "checking" claims no colour.
function StatusTile({ dot }: { dot: PrinterDot & { show: true } }) {
  const checking = dot.reason === "checking";
  const Icon = checking ? Loader2 : dot.ok ? Check : Bang;
  const tone = checking ? PRINTER_TILE_NEUTRAL_CLASS : dot.ok ? PRINTER_TILE_OK_CLASS : PRINTER_TILE_BAD_CLASS;
  return (
    <span aria-hidden="true" className={cn(PRINTER_STATUS_CIRCLE_CLASS, tone)}>
      <Icon className={cn("size-[17px]", checking && "motion-safe:animate-spin")} strokeWidth={2.4} />
    </span>
  );
}

export function PrinterStatusBanner({ dot, copy }: { dot: PrinterDot & { show: true }; copy: PrinterHeadline }) {
  const snapshot = useDevicePrinter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [reconnecting, setReconnecting] = useState(false);
  // Another tab owns the printer: fixes that act on it cannot work from here.
  const fix = copy.fix;
  const blocked = snapshot.status === "elsewhere" && fix !== null && fix !== "print-here";
  const look = PRINTER_STATUS_LOOK[dot.reason === "checking" ? "checking" : dot.ok ? "ok" : "bad"];

  // Targets are looked up inside THIS banner's panel, never the whole page.
  const focusAndShow = (selector: string): void => {
    const panel = rootRef.current?.closest(PANEL_SELECTOR) ?? null;
    const target = panel?.querySelector<HTMLElement>(selector) ?? null;
    if (target === null) return;
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
  };

  // Runs inside the click handler, so a reconnect that needs a tap still has its
  // user activation: reconnect() is called before anything is awaited.
  const runFix = (kind: PrinterFix): void => {
    if (kind === "reconnect") {
      setReconnecting(true);
      void toastConnectOutcome(devicePrinter().reconnect()).finally(() => setReconnecting(false));
      return;
    }
    focusAndShow(kind === "setup" ? DEVICE_SECTION_SELECTOR : DESIGNATE_SELECTOR);
  };

  return (
    <div ref={rootRef} role="status" aria-live="polite" className={cn(PRINTER_STATUS_CARD_CLASS, look.card)}>
      <StatusTile dot={dot} />
      <div className="min-w-0 flex-1">
        <p className={cn(PRINTER_STATUS_HEAD_CLASS, look.head)}>{copy.headline}</p>
        {copy.detail !== "" && <p className={PRINTER_STATUS_DETAIL_CLASS}>{copy.detail}</p>}
        {fix !== null && (
          <Button
            type="button"
            variant="outline"
            className={cn(PRINTER_BUTTON_SMALL_CLASS, "mt-2")}
            disabled={blocked || reconnecting}
            onClick={() => runFix(fix)}
          >
            {reconnecting && fix === "reconnect" ? RECONNECTING_LABEL : FIX_LABEL[fix]}
          </Button>
        )}
        {blocked && <p className={`${PRINTER_STATUS_DETAIL_CLASS} mt-2`}>{PRINTER_ELSEWHERE_MESSAGE}</p>}
      </div>
    </div>
  );
}
