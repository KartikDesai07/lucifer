// The STARTUP printer check (owner decision 2026-09-19).
//
// What it is: once, shortly after the app starts with Windows, the shell looks
// at whether the printer the operator chose is actually present. If it is not,
// it says so — a tray notification and a log line — and stops there.
//
// What it is DELIBERATELY NOT:
//   · it NEVER runs when the screen locks or the machine sleeps or wakes.
//     This app subscribes to none of those signals, on purpose: the counter PC
//     is locked and unlocked all day, and a check on every unlock would be
//     noise at best and a repeated interruption at worst. The banned-needle
//     pins in printer-check.test.ts keep it that way.
//   · it NEVER blocks, delays, or refuses a print. It cannot: it is a pure
//     observer that only logs and notifies. The print path (print.ts) makes
//     its own decision per job, and a printer that comes back online starts
//     working again immediately with nothing to reset. This is the owner's
//     hard requirement — "lock na ho to bhi na le raha ho aesa hona hi nahi
//     chahiye" — so this module has no state the printer path reads.
//   · it NEVER changes the stored printer choice. A printer missing at 9am
//     (switched off overnight) must still be the chosen printer at 10am.
import type { Logger } from "./log";

/** How long after startup to look. Long enough for Windows to finish bringing
 *  up the spooler and USB devices on a cold boot — a check that fires too
 *  early would report a healthy printer as missing. */
export const PRINTER_CHECK_DELAY_MS = 20_000;

export const PRINTER_MISSING_TITLE = "Printer not found";
export function printerMissingMessage(name: string): string {
  return `"${name}" is not connected right now. Slips will not print until it is back. Check the printer and its cable.`;
}
export const PRINTER_NOT_CHOSEN_MESSAGE =
  "No printer is chosen on this PC. Open Settings, then Printing, and pick the printer.";

export interface PrinterCheckDeps {
  /** The operator's stored choice; null when nothing has been picked yet. */
  getDeviceName(): string | null;
  /** Every printer Windows currently reports, by OS name. */
  listPrinterNames(): Promise<string[]>;
  /** Raised from the tray so a hidden window is not required to see it. */
  notify(title: string, body: string): void;
  log: Logger;
}

/**
 * Runs the check ONCE. Returns what it found so the caller (and the tests) can
 * assert on it; the return value is advisory only and nothing in the print
 * path consults it.
 *
 * Any failure here is swallowed: this is a convenience, and it must never be
 * able to take the app — or printing — down with it.
 */
export async function runPrinterCheck(
  deps: PrinterCheckDeps,
): Promise<"ok" | "missing" | "not-chosen" | "unavailable"> {
  try {
    const chosen = deps.getDeviceName();
    if (chosen === null || chosen.length === 0) {
      deps.log.info("startup printer check: no printer chosen on this PC");
      deps.notify(PRINTER_MISSING_TITLE, PRINTER_NOT_CHOSEN_MESSAGE);
      return "not-chosen";
    }

    const names = await deps.listPrinterNames();
    // An EMPTY list is treated as "cannot tell", never as "missing": the
    // spooler can briefly report nothing while it is still starting, and
    // crying wolf on a healthy printer is worse than staying quiet.
    if (names.length === 0) {
      deps.log.info("startup printer check: Windows reported no printers yet, skipping");
      return "unavailable";
    }

    if (names.includes(chosen)) {
      deps.log.info(`startup printer check: chosen printer is connected (${names.length} devices)`);
      return "ok";
    }

    deps.log.info(`startup printer check: chosen printer is NOT among the ${names.length} connected devices`);
    deps.notify(PRINTER_MISSING_TITLE, printerMissingMessage(chosen));
    return "missing";
  } catch (error) {
    // Never throw out of a timer callback, and never let this stop anything.
    deps.log.error(
      `startup printer check failed: ${error instanceof Error ? error.name : "unknown"}`,
    );
    return "unavailable";
  }
}

/**
 * Schedules the one-shot check. Returns a canceller so app shutdown does not
 * leave a timer holding the process open.
 */
export function schedulePrinterCheck(deps: PrinterCheckDeps, delayMs = PRINTER_CHECK_DELAY_MS): () => void {
  const timer = setTimeout(() => {
    void runPrinterCheck(deps);
  }, delayMs);
  // A pending convenience check must never hold the app open by itself.
  if (typeof timer.unref === "function") timer.unref();
  return () => clearTimeout(timer);
}
