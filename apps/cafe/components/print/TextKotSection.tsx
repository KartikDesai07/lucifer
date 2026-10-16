"use client";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): "Fast text KOTs (English only)" in the printer panel of the device that
// prints. One row per printer this device prints kitchen slips on (hooks/use-text-kot-printers.ts), each with its switch.
// Turning it on prints the text test slip on that very printer, through the bridge's busy window (never between two
// slips), then asks staff; only "Yes" turns it on, kept in this device's storage. Turning it off is immediate. The 80 mm
// "Characters per line" choice is made while the switch is off, so the printer proves the width it will print at.
import { useId, useState } from "react";
import { Zap } from "lucide-react";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PrinterSection } from "@/components/print/PrinterSection";
import { PRINTER_ACTION_CLASS } from "@/components/print/printer-classes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { useTextKot, useTextKotPrinters } from "@/hooks/use-text-kot-printers";
import { PRINT_HOST_BUSY_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { textColumnsOf } from "@/lib/printer/kot-text/text-layout";
import type { TextKotPrinter } from "@/lib/printer/kot-text/text-kot-printers";
import { writeTextKot } from "@/lib/printer/kot-text/text-kot-store";
import { textTestJob } from "@/lib/printer/kot-text/text-test-slip";

const TITLE = "Fast text KOTs (English only)";
const DESCRIPTION =
  "Prints English-only kitchen tickets as text in the printer's own font: much faster on Bluetooth. Tickets with Hindi, Gujarati or any other script, a logo or a QR code still print as now.";
const SWITCH_LABEL = "Fast text KOTs";
const COLUMNS_LABEL = "Characters per line";
const QUESTION = "Did it print clearly, with the ruler on one line?";
const KEPT_OFF = "Kept off: kitchen tickets print as now.";
const TRY_42 = "Keep it off, or try Characters per line: 42";
const ON_MESSAGE = "On: English-only kitchen tickets print as text on this printer.";
const PRINTING = "Printing the text test…";
const BUSY_MESSAGE = "This device is busy with another slip — try again in a moment.";
const TEST_FAILED_MESSAGE = "Could not print the text test. The switch stays off.";

type Phase = "idle" | "printing" | "confirm" | "kept-off";

export function TextKotSection() {
  const printers = useTextKotPrinters();
  if (printers.length === 0) return null;
  return (
    <PrinterSection icon={Zap} title={TITLE} description={DESCRIPTION}>
      {printers.map((printer) => (
        <TextKotRow key={printer.key} printer={printer} />
      ))}
    </PrinterSection>
  );
}

function TextKotRow({ printer }: { printer: TextKotPrinter }) {
  const { queueTestSlip, current } = usePrintHostContext();
  const settings = useSettings();
  const choice = useTextKot(printer.key);
  const switchId = useId();
  const [narrow80, setNarrow80] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const on = choice !== null;
  const wide = printer.paper === "80mm";

  const turnOn = async () => {
    setError(null);
    // The test slip is made before anything is queued: a slip that cannot be made leaves the switch off (never a throw).
    let bytes: Uint8Array;
    try {
      bytes = textTestJob({ cafeName: settings.data?.restaurantName, columns: textColumnsOf(printer.paper, narrow80) });
    } catch {
      setError(TEST_FAILED_MESSAGE);
      return;
    }
    setPhase("printing");
    try {
      await queueTestSlip(() => printer.write(bytes));
      setPhase("confirm");
    } catch (err) {
      // The printer's own sentence (the bridge also shows it); a busy device is a refusal, never a queue; a test the
      // bridge gave up on (its watchdog) is this section's own sentence, never "reprint it from Orders" (the review's m-4).
      const message = err instanceof Error ? err.message : TEST_FAILED_MESSAGE;
      setError(message === PRINT_HOST_BUSY_MESSAGE ? BUSY_MESSAGE : message === PRINT_HOST_PRINT_FAILED_MESSAGE ? TEST_FAILED_MESSAGE : message);
      setPhase("idle");
    }
  };

  const answer = (clear: boolean) => {
    if (clear) {
      writeTextKot(printer.key, { narrow80: wide && narrow80 });
      setPhase("idle");
    } else setPhase("kept-off");
  };

  const turnOff = () => {
    // The choice it was proven at stays chosen for its next test (the review's m-3).
    if (choice !== null) setNarrow80(choice.narrow80);
    writeTextKot(printer.key, null);
    setPhase("idle");
    setError(null);
  };

  const busy = phase === "printing" || phase === "confirm";
  return (
    <div className="space-y-2 rounded-md border border-brand-rule p-3">
      <div className="flex min-h-11 items-center gap-3">
        <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block font-medium text-brand-ink">{printer.name}</span>
          <span className="block text-xs text-brand-muted">{printer.paper === "80mm" ? "80 mm" : "58 mm"}</span>
        </label>
        <Switch
          id={switchId}
          checked={on}
          aria-label={`${SWITCH_LABEL}: ${printer.name}`}
          disabled={!on && (busy || current !== null)}
          onCheckedChange={(next) => (next ? void turnOn() : turnOff())}
        />
      </div>
      {wide && (
        <div role="group" aria-label={COLUMNS_LABEL} className="space-y-1">
          <p className="text-xs font-medium text-brand-ink">{COLUMNS_LABEL}</p>
          <div className="grid grid-cols-2 gap-2">
            {[false, true].map((narrow) => {
              const chosen = choice !== null ? choice.narrow80 === narrow : narrow80 === narrow;
              return (
                <Button
                  key={narrow ? "42" : "auto"}
                  type="button"
                  variant={chosen ? "default" : "outline"}
                  aria-pressed={chosen}
                  disabled={on || busy}
                  onClick={() => setNarrow80(narrow)}
                  className={PRINTER_ACTION_CLASS}
                >
                  {narrow ? "42" : "Automatic"}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {phase === "printing" && <p className="text-xs text-brand-muted">{PRINTING}</p>}
      {phase === "confirm" && <InlineConfirm question={QUESTION} yes="Yes" no="No" disabled={false} onYes={() => answer(true)} onNo={() => answer(false)} />}
      {phase === "kept-off" && <p className="text-xs text-brand-muted">{wide && !narrow80 ? TRY_42 : KEPT_OFF}</p>}
      {on && phase === "idle" && <p className="text-xs text-brand-muted">{ON_MESSAGE}</p>}
      {error !== null && <p role="alert" className="text-xs text-brand-danger">{error}</p>}
    </div>
  );
}
