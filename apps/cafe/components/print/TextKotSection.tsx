"use client";

// Printing Phase 4 (spec 2026-10-15 §5.1, S2): the text KOT switch in the printer panel of the device that prints; "Faster
// KOTs" since PX-3 Task 10 (spec §6.6 item 4; mockup t-settings: the title alone, each row "Print KOTs as plain text" over
// its one line, the printer named once there are two). One row per printer this device prints kitchen slips on
// (hooks/use-text-kot-printers.ts), each with its switch.
// Turning it on prints the text test slip on that very printer, through the bridge's busy window (never between two
// slips), then asks staff; only "Yes" turns it on, kept in this device's storage. Turning it off is immediate. The 80 mm
// "Characters per line" choice is made while the switch is off, so the printer proves the width it will print at.
import { useId, useState } from "react";
import { Zap } from "lucide-react";

import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { InlineConfirm } from "@/components/print/PrintHostCardParts";
import { PanelSection } from "@/components/print/PanelSection";
import {
  PRINTER_ERROR_CLASS,
  PRINTER_NOTE_CLASS,
  PRINTER_RULE_BLOCK_CLASS,
  PRINTER_SECTION_SUB_CLASS,
  PRINTER_SEG_BUTTON_CLASS,
  PRINTER_SEG_OFF_CLASS,
  PRINTER_SEG_ON_CLASS,
  PRINTER_SEG_TRACK_CLASS,
  PRINTER_SWITCH_CLASS,
} from "@/components/print/printer-classes";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { useTextKot, useTextKotPrinters } from "@/hooks/use-text-kot-printers";
import { desktopRefusalWordsOf } from "@/lib/desktop-shell-messages";
import { PRINT_HOST_BUSY_MESSAGE, PRINT_HOST_PRINT_FAILED_MESSAGE } from "@/lib/print-host-slips";
import { textColumnsOf } from "@/lib/printer/kot-text/text-layout";
import type { TextKotPrinter } from "@/lib/printer/kot-text/text-kot-printers";
import { writeTextKot } from "@/lib/printer/kot-text/text-kot-store";
import { textTestJob } from "@/lib/printer/kot-text/text-test-slip";
import { textKotRowWordsOf } from "@/lib/printer/settings-view";
import { cn } from "@/lib/utils";

const TITLE = "Faster KOTs";
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
    <PanelSection icon={<Zap />} title={TITLE}>
      {printers.map((printer) => (
        <TextKotRow key={printer.key} printer={printer} rows={printers.length} />
      ))}
    </PanelSection>
  );
}

function TextKotRow({ printer, rows }: { printer: TextKotPrinter; rows: number }) {
  const { queueTestSlip, printing } = usePrintHostContext();
  const settings = useSettings();
  const choice = useTextKot(printer.key);
  const switchId = useId();
  const [narrow80, setNarrow80] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const on = choice !== null;
  const wide = printer.paper === "80mm";
  const words = textKotRowWordsOf(printer.name, rows);

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
      setError(message === PRINT_HOST_BUSY_MESSAGE ? BUSY_MESSAGE : message === PRINT_HOST_PRINT_FAILED_MESSAGE ? TEST_FAILED_MESSAGE : desktopRefusalWordsOf(message));
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
    <div className={PRINTER_RULE_BLOCK_CLASS}>
      <div className="flex items-center gap-3">
        <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer">
          <span className="block break-words text-[13.5px] font-medium">{words.label}</span>
          <span className={`block break-words ${PRINTER_SECTION_SUB_CLASS}`}>{words.sub}</span>
        </label>
        <Switch
          id={switchId}
          className={PRINTER_SWITCH_CLASS}
          checked={on}
          aria-label={`${words.label}: ${printer.name}`}
          disabled={!on && (busy || printing)}
          onCheckedChange={(next) => (next ? void turnOn() : turnOff())}
        />
      </div>
      {wide && (
        <div role="group" aria-label={COLUMNS_LABEL} className="flex items-center justify-between gap-3">
          <p className="text-[13.5px]">{COLUMNS_LABEL}</p>
          <div className={PRINTER_SEG_TRACK_CLASS}>
            {[false, true].map((narrow) => {
              const chosen = choice !== null ? choice.narrow80 === narrow : narrow80 === narrow;
              return (
                <button
                  key={narrow ? "42" : "auto"}
                  type="button"
                  aria-pressed={chosen}
                  disabled={on || busy}
                  onClick={() => setNarrow80(narrow)}
                  className={cn(PRINTER_SEG_BUTTON_CLASS, chosen ? PRINTER_SEG_ON_CLASS : PRINTER_SEG_OFF_CLASS)}
                >
                  {narrow ? "42" : "Automatic"}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {phase === "printing" && <p className={PRINTER_NOTE_CLASS}>{PRINTING}</p>}
      {phase === "confirm" && <InlineConfirm question={QUESTION} yes="Yes" no="No" disabled={false} onYes={() => answer(true)} onNo={() => answer(false)} />}
      {phase === "kept-off" && <p className={PRINTER_NOTE_CLASS}>{wide && !narrow80 ? TRY_42 : KEPT_OFF}</p>}
      {on && phase === "idle" && <p className={PRINTER_NOTE_CLASS}>{ON_MESSAGE}</p>}
      {error !== null && <p role="alert" className={PRINTER_ERROR_CLASS}>{error}</p>}
    </div>
  );
}
