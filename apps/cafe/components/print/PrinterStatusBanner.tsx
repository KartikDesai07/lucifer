"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toastConnectOutcome } from "@/components/print/connect-outcome";
import { useDevicePrinter } from "@/hooks/use-device-printer";
import { PRINTER_ELSEWHERE_MESSAGE, devicePrinter } from "@/lib/printer/device-printer";
import type { PrinterDot, PrinterFix, PrinterHeadline } from "@/lib/printer/printer-dot";
import {
  PRINTER_ACTION_CLASS,
  PRINTER_TILE_BAD_CLASS,
  PRINTER_TILE_CLASS,
  PRINTER_TILE_NEUTRAL_CLASS,
  PRINTER_TILE_OK_CLASS,
} from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";

// The panel's status line: an icon tile, one headline, one sentence, and at most
// ONE button that fixes the problem. role=status so a screen reader hears a change;
// the tile is decoration — the words carry the meaning. "Checking" is a spinner
// on a neutral tile: it is neither good nor bad yet.
const FIX_LABEL: Record<PrinterFix, string> = {
  reconnect: "Reconnect",
  setup: "Set up printing",
  "print-here": "Print on this device",
};
const RECONNECTING_LABEL = "Reconnecting…";
const PANEL_SELECTOR = "[data-printer-panel]";
const DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]';
const DESIGNATE_SELECTOR = '[data-action="designate"]';

// The tile's icon and tone follow the dot; "checking" claims no colour.
function StatusTile({ dot }: { dot: PrinterDot & { show: true } }) {
  const checking = dot.reason === "checking";
  const Icon = checking ? Loader2 : dot.ok ? CheckCircle2 : AlertCircle;
  const tone = checking ? PRINTER_TILE_NEUTRAL_CLASS : dot.ok ? PRINTER_TILE_OK_CLASS : PRINTER_TILE_BAD_CLASS;
  return (
    <span aria-hidden="true" className={cn(PRINTER_TILE_CLASS, tone)}>
      <Icon className={cn("h-5 w-5", checking && "motion-safe:animate-spin")} />
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
    <div ref={rootRef} role="status" aria-live="polite" className="flex items-start gap-3 rounded-lg border p-4">
      <StatusTile dot={dot} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-base font-semibold">{copy.headline}</p>
        {copy.detail !== "" && <p className="text-sm text-muted-foreground">{copy.detail}</p>}
        {fix !== null && (
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              className={cn(PRINTER_ACTION_CLASS, "w-full sm:w-auto")}
              disabled={blocked || reconnecting}
              onClick={() => runFix(fix)}
            >
              {reconnecting && fix === "reconnect" ? RECONNECTING_LABEL : FIX_LABEL[fix]}
            </Button>
            {blocked && <p className="pt-2 text-sm text-muted-foreground">{PRINTER_ELSEWHERE_MESSAGE}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
