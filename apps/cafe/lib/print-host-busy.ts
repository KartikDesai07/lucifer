// P2 N4: does this device hold a print job right now? A newer build never reloads the page while it does
// (lib/quiet-reload.ts), or a job leased to this tab would expire unprinted and come back as a reprint. Two kinds of
// hold: a token holder (components/layout/PrintHostProvider.tsx while its bridge prints a slip, claim → onAfterPrint)
// and the print agent's lease request and print, each counted while in flight (hooks/use-print-agent.ts wraps them
// with trackPrintBusy, which hands back the same outcome). A printed slip whose ack is not sent yet survives a reload
// already (the agent's pending-ack store). From the reload on, no new lease or claim starts (closePrintHost). Module
// state only; no React, no request.
//
// A third kind (the P2 follow-ups' final review, F1): a pull source read at every call. The print agent registers one
// for a slip leased to this tab that waits in its held list (the bridge still busy, a lease's extra jobs) until that
// slip's tracked print starts, or it is handed back (hooks/use-print-agent.ts). Without it a gate's look landing between
// the bridge letting go and the agent hearing so would load the page, and the old page start the slip under the load.
//
// Two more parts for "no document load cuts a print job" (P2 follow-ups R71/R72): printHostBusySince() says when the
// current continuous hold began (holders and in-flight work that overlap or hand over without a gap are one hold), so
// Refresh can tell a hold that lasted past PRINT_STUCK_MS; and leaveWhenPrintFree() is the one gate every document
// load goes through: it waits (a local timer, no request) until print is free and the caller's own condition holds,
// then closes the print host and goes, once.

const holders = new Set<symbol>();
let inFlight = 0;

// When the current continuous hold began, null while free. Kept in step with printHostBusy() after every change.
let busySince: number | null = null;
let clock: () => number = Date.now;

/** Tests only: the clock that stamps a hold's start. Returns a function that puts the real clock back. */
export function setPrintBusyClock(next: () => number): () => void {
  const before = clock;
  clock = next;
  return () => {
    clock = before;
  };
}

function syncSince(): void {
  if (!printHostBusy()) busySince = null;
  else if (busySince === null) busySince = clock();
}

/** This holder holds a print job (true) or no longer does (false, also on unmount). */
export function holdPrintBusy(token: symbol, busy: boolean): void {
  if (busy) holders.add(token);
  else holders.delete(token);
  syncSince();
}

/** Counts `work` while it is pending; the returned promise settles exactly as `work` does, after the count lets go. */
export function trackPrintBusy<T>(work: Promise<T>): Promise<T> {
  inFlight += 1;
  syncSince();
  return work.then(
    (value) => {
      inFlight -= 1;
      syncSince();
      return value;
    },
    (error: unknown) => {
      inFlight -= 1;
      syncSince();
      throw error;
    },
  );
}

const sources = new Set<{ busy: () => boolean }>();

/** Registers a pull source of print work, read at every printHostBusy() call (so by the hold clock and the gate too); one
 *  that throws counts as not busy. Returns its unregister (calling it twice is harmless). */
export function addPrintBusySource(busy: () => boolean): () => void {
  const entry = { busy };
  sources.add(entry);
  syncSince();
  return () => {
    sources.delete(entry);
    syncSince();
  };
}

function sourceBusy(entry: { busy: () => boolean }): boolean {
  try {
    return entry.busy() === true;
  } catch {
    return false;
  }
}

export function printHostBusy(): boolean {
  return holders.size > 0 || inFlight > 0 || [...sources].some(sourceBusy);
}

/** A continuous hold older than this counts as stuck (Refresh then offers "Refresh anyway"). */
export const PRINT_STUCK_MS = 30_000;

/** When the current continuous hold began (ms, the clock's time), or null while print is free. */
export function printHostBusySince(): number | null {
  syncSince();
  return busySince;
}

/** How often a waiting gate looks again: a local timer, never a request. */
export const PRINT_FREE_CHECK_MS = 250;

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

export type LeaveWhenPrintFreeOptions = {
  /** An extra wait condition the caller adds (the navigation passes "the line is up"); none = no extra wait. */
  ready?: () => boolean;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
};

/** The one gate every document load the staff app starts goes through. Once print is free and `ready` holds it closes
 *  the print host and then runs `go`, exactly once, at once (a load while a leased job is on its way would expire the
 *  job into a REPRINT). Until then it looks again every PRINT_FREE_CHECK_MS on a local timer. Returns its cancel: it
 *  stops the gate for good (no go, no close); calling it twice or after the gate went is harmless. */
export function leaveWhenPrintFree(go: () => void, options: LeaveWhenPrintFreeOptions = {}): () => void {
  const setTimer = options.setTimer ?? ((run: () => void, ms: number): unknown => globalThis.setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((id: unknown): void => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));
  let finished = false;
  let timer: unknown = null;
  const ready = (): boolean => !printHostBusy() && (options.ready?.() ?? true);
  const cancel = (): void => {
    finished = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  const look = (): void => {
    timer = null;
    if (finished) return;
    if (ready()) {
      finished = true;
      closePrintHost();
      go();
      return;
    }
    timer = setTimer(look, PRINT_FREE_CHECK_MS);
  };
  look();
  return cancel;
}
