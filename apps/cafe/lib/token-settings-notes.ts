import { defaultBillPrinterOf, printersModeOn, type PrinterConfig } from "@pos/shared/print-printers";

// The Tokens & numbering page's notes (the token fix after the print-customization merge, plan
// 2026-10-06-token-direct-fix.md, T2–T4), in one place: the page shows them, and docs/GO-LIVE-CHECKLIST.md quotes
// the reload hint word for word (go-live-runbook.test.ts). Pure and client-safe.

/** T2, under the tokens switch. A page from before the token slip leases no token job (lib/print-lease.ts
 *  leaseKindFence), so its token slips wait, visibly, in the waiting-slips panel for a reloaded page. */
export const TOKENS_RELOAD_HINT =
  "Before turning tokens on, reload every POS screen and restart the Windows app on every counter PC (an older page never prints token slips; they wait in the panel).";

/** T3: a token prints where the bill does (lib/print-printer-routing.ts). In printers mode with no printer that takes
 *  bills, every token (and every bill) is made failed at once: "No printer is set up for bills." */
export const TOKENS_NO_BILL_PRINTER_WARNING = "Token slips print at the bill printer, and none is set up. Tick Bill on a printer in Printer setup.";

/** T3: printers mode is on, and no routable printer takes bills. Simple mode prints a token where it prints the bill. */
export function tokensHaveNoBillPrinter(printers: readonly PrinterConfig[]): boolean {
  return printersModeOn(printers) && defaultBillPrinterOf(printers) === null;
}

/** T4, under the restart time. The business day a number belongs to moves the moment the time changes
 *  (@pos/shared/slip-day), so a change during service can start tonight's numbers again or jump them ahead. */
export const NUMBER_RESET_HINT =
  "A new time takes full effect from the next day. Changing it during service can repeat or skip tonight's token, kitchen ticket and bill numbers, so change it outside service hours. Order IDs still change at midnight.";
