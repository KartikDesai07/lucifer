// P2 N4: does this device hold a print job right now? A newer build never reloads the page while it does
// (lib/quiet-reload.ts), or a job leased to this tab would expire unprinted and come back as a reprint. Two kinds of
// hold: a token holder (components/layout/PrintHostProvider.tsx while its bridge prints a slip, claim → onAfterPrint)
// and the print agent's lease request and print, each counted while in flight (hooks/use-print-agent.ts wraps them
// with trackPrintBusy, which hands back the same outcome). A printed slip whose ack is not sent yet survives a reload
// already (the agent's pending-ack store). From the reload on, no new lease or claim starts (closePrintHost). Module
// state only; no React, no request.

const holders = new Set<symbol>();
let inFlight = 0;

/** This holder holds a print job (true) or no longer does (false, also on unmount). */
export function holdPrintBusy(token: symbol, busy: boolean): void {
  if (busy) holders.add(token);
  else holders.delete(token);
}

/** Counts `work` while it is pending; the returned promise settles exactly as `work` does, after the count lets go. */
export function trackPrintBusy<T>(work: Promise<T>): Promise<T> {
  inFlight += 1;
  return work.then(
    (value) => {
      inFlight -= 1;
      return value;
    },
    (error: unknown) => {
      inFlight -= 1;
      throw error;
    },
  );
}

export function printHostBusy(): boolean {
  return holders.size > 0 || inFlight > 0;
}

/** How long a page that began its reload starts no new print work: the same 8 s after which a reload that did not tear
 *  the page down counts as not happened (lib/page-refresh.ts REFRESH_SETTLE_MS). */
export const PRINT_HOST_CLOSING_MS = 8_000;
let closingUntil = 0;

/** Right before location.reload() (the verifiers' I1): the old page lives on until the new document answers, and a
 *  lease or claim it won meanwhile would go with it (the job expires into a REPRINT, a claimed row is lost). */
export function closePrintHost(now: number = Date.now()): void {
  closingUntil = now + PRINT_HOST_CLOSING_MS;
}

export function printHostClosing(now: number = Date.now()): boolean {
  return now < closingUntil;
}

/** The agent's lease: refused while the page is closing (as a lease with no answer: the agent looks again later,
 *  lib/print-agent.ts), otherwise started and tracked like any print work. */
export function leaseUnlessClosing<T>(start: () => Promise<T>): Promise<T> {
  if (printHostClosing()) return Promise.reject(new Error("The page is reloading"));
  return trackPrintBusy(start());
}
