// P2 N4: does this device hold a print job right now? A newer build never reloads the page while it does
// (lib/quiet-reload.ts), or a job leased to this tab would expire unprinted and come back as a reprint. Two kinds of
// hold: a token holder (components/layout/PrintHostProvider.tsx while its bridge prints a slip, claim → onAfterPrint)
// and the print agent's lease request and print, each counted while in flight (hooks/use-print-agent.ts wraps them
// with trackPrintBusy, which hands back the same outcome). A printed slip whose ack is not sent yet survives a reload
// already (the agent's pending-ack store). Module state only; no React, no request.

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
