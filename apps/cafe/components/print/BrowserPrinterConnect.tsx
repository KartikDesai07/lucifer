"use client";

import { Printer } from "lucide-react";

import {
  PRINTER_BLOCK_TITLE_CLASS,
  PRINTER_BUTTON_CLASS,
  PRINTER_BUTTON_PRIMARY_CLASS,
  PRINTER_HINT_CLASS,
  PRINTER_NOTE_CLASS,
  PRINTER_RULE_BLOCK_CLASS,
  PRINTER_STEP_CLASS,
  PRINTER_STEP_NUM_CLASS,
} from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";

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

// Connecting a printer from a browser: ONE button (the HTML's Connect printer), three plain steps, and (only
// where the browser can) a quiet second way for printers that need no pairing.
// Prop-driven: the section owns the click handlers, which must start the
// chooser with nothing awaited before it.
export function BrowserPrinterConnect({ paired, nearby, locked, notSeen, onConnect, onSearchNearby }: BrowserPrinterConnectProps) {
  const steps = [STEP_ON, paired ? STEP_PAIR : STEP_CLOSE, STEP_TAP];
  return (
    <div className="flex flex-col gap-3">
      <Button className={PRINTER_BUTTON_PRIMARY_CLASS} onClick={onConnect} disabled={locked}>
        <Printer aria-hidden="true" />
        Connect printer
      </Button>
      {notSeen && (
        <p role="status" className={PRINTER_HINT_CLASS}>
          {paired ? NOT_SEEN_PAIRED : NOT_SEEN_NEARBY_ONLY}
          {paired && (nearby ? " — or tap Search nearby printers." : ".")}
        </p>
      )}
      <div>
        <p className={`${PRINTER_BLOCK_TITLE_CLASS} mb-2`}>{HOW_TITLE}</p>
        <ol>
          {steps.map((step, index) => (
            <li key={step} className={PRINTER_STEP_CLASS}>
              <span aria-hidden="true" className={PRINTER_STEP_NUM_CLASS}>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">{step}</span>
            </li>
          ))}
        </ol>
      </div>
      {nearby && (
        <div className={PRINTER_RULE_BLOCK_CLASS}>
          <p className={PRINTER_BLOCK_TITLE_CLASS}>{NEARBY_TITLE}</p>
          <Button className={`${PRINTER_BUTTON_CLASS} self-start`} variant="outline" onClick={onSearchNearby} disabled={locked}>
            Search nearby printers
          </Button>
          <p className={`${PRINTER_NOTE_CLASS} -mt-0.5`}>{NEARBY_HELP}</p>
        </div>
      )}
    </div>
  );
}
