"use client";

import type { PrinterProblem } from "@pos/shared/print-failover";
import {
  PRINTER_HERE_CARD_CLASS,
  PRINTER_HERE_DOT_CLASS,
  PRINTER_HERE_LIST_CLASS,
  PRINTER_HERE_NAME_CLASS,
  PRINTER_HERE_ROW_CLASS,
  PRINTER_HERE_SUB_CLASS,
  PRINTER_HERE_TITLE_CLASS,
  PRINTER_HERE_TONE,
  PRINTER_HERE_WORD_CLASS,
} from "@/components/print/printer-classes";
import type { PrinterHere } from "@/lib/print-agent-here";
import { connOf } from "@/lib/printer/printer-status-view";
import { cn } from "@/lib/utils";

// Printer UX PX-2 (spec §6.2, §6.5; mockup s-pm-tablet): in printers mode, every printer this device prints, in the setup's
// order, so staff see WHICH one is down (the client's tablet: Kitchen down, Bill ready). Words only: the status card's one
// Reconnect reconnects every one that is down; per-printer buttons live in the settings.

const TITLE = "On this device";
const PROBLEM_WORDS: Partial<Record<PrinterProblem, string>> = { "paper-out": "Out of paper", "cover-open": "Cover open", error: "Error" };

/** A printer's state word (spec §6.2). Not connected first (it must be reconnected before anything else helps); none for
 *  a Windows printer chosen by name (the app reports no state, R9) or one another tab holds. */
export function hereStateOf(printer: PrinterHere): { tone: keyof typeof PRINTER_HERE_TONE; word: string } {
  if (printer.status === "disconnected" || printer.status === "needs-tap") return { tone: "bad", word: "Not connected" };
  const problem = printer.problem !== undefined ? PROBLEM_WORDS[printer.problem] : undefined;
  if (problem !== undefined) return { tone: "bad", word: problem };
  if (printer.status === "connected") return { tone: "ok", word: "Ready" };
  if (printer.status === "connecting") return { tone: "quiet", word: "Connecting…" };
  return { tone: "quiet", word: "" };
}

export function PrinterHereCard({ here, windowsApp }: { here: readonly PrinterHere[]; windowsApp: boolean }) {
  return (
    <section className={PRINTER_HERE_CARD_CLASS}>
      <h3 className={PRINTER_HERE_TITLE_CLASS}>{TITLE}</h3>
      <ul className={PRINTER_HERE_LIST_CLASS}>
        {here.map((printer) => {
          const state = hereStateOf(printer);
          const tone = PRINTER_HERE_TONE[state.tone];
          return (
            <li key={printer.id} className={PRINTER_HERE_ROW_CLASS}>
              <span aria-hidden="true" className={cn(PRINTER_HERE_DOT_CLASS, tone.dot)} />
              <span className={PRINTER_HERE_NAME_CLASS}>
                {printer.name}
                <span className={PRINTER_HERE_SUB_CLASS}>{connOf(printer.appName, printer.transport, windowsApp)}</span>
              </span>
              {state.word !== "" && <span className={cn(PRINTER_HERE_WORD_CLASS, tone.word)}>{state.word}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
