"use client";

import { Printer } from "lucide-react";

import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const BUTTON_CLASS = cn(PRINTER_ACTION_CLASS, "w-full sm:w-auto");
const HOW_TITLE = "How to connect";
const STEP_ON = "Turn the printer on and load paper.";
const STEP_PAIR = "Bluetooth printer: pair it in this device's Bluetooth settings first. USB printer: plug it in.";
const STEP_CLOSE = "Keep the printer close to this device.";
const STEP_TAP = "Tap Connect printer, then pick your printer from the list.";
const NEARBY_TITLE = "Printer not in the list?";
const NEARBY_HELP = "Finds printers that do not need pairing.";
const NOT_SEEN_PAIRED =
  "Did not see your printer? Pair it in Bluetooth settings first (USB printer: check the cable), then tap Connect printer again";
// A browser that only searches nearby has nothing to pair first.
const NOT_SEEN_NEARBY_ONLY = "Did not see your printer? Turn it on and keep it close, then tap Connect printer again.";

interface BrowserPrinterConnectProps {
  /** The browser lists paired Bluetooth and USB printers (Web Serial). */
  paired: boolean;
  /** A second way exists: search for nearby printers that need no pairing. */
  nearby: boolean;
  locked: boolean;
  /** The first list was closed without a pick. */
  notSeen: boolean;
  onConnect: () => void;
  onSearchNearby: () => void;
}

// Connecting a printer from a browser: ONE button, three plain steps, and (only
// where the browser can) a quiet second way for printers that need no pairing.
// Prop-driven: the section owns the click handlers, which must start the
// chooser with nothing awaited before it.
export function BrowserPrinterConnect({ paired, nearby, locked, notSeen, onConnect, onSearchNearby }: BrowserPrinterConnectProps) {
  const steps = [STEP_ON, paired ? STEP_PAIR : STEP_CLOSE, STEP_TAP];
  return (
    <div className="space-y-4">
      <Button className={BUTTON_CLASS} onClick={onConnect} disabled={locked}>
        <Printer className="mr-2 h-4 w-4" aria-hidden="true" />
        Connect printer
      </Button>
      {notSeen && (
        <p role="status" className="rounded-md bg-brand-wash p-3 text-brand-ink">
          {paired ? NOT_SEEN_PAIRED : NOT_SEEN_NEARBY_ONLY}
          {paired && (nearby ? " — or tap Search nearby printers." : ".")}
        </p>
      )}
      <div className="space-y-2">
        <p className="font-medium text-brand-ink">{HOW_TITLE}</p>
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-primary-soft text-xs font-semibold text-brand-primary"
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </div>
      {nearby && (
        <div className="space-y-2 border-t border-brand-rule pt-3">
          <p className="font-medium text-brand-ink">{NEARBY_TITLE}</p>
          <Button className={BUTTON_CLASS} variant="outline" onClick={onSearchNearby} disabled={locked}>
            Search nearby printers
          </Button>
          <p className="text-xs text-brand-muted">{NEARBY_HELP}</p>
        </div>
      )}
    </div>
  );
}
