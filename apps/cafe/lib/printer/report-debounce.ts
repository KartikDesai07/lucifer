// Coalesces a flapping value into at most one report: every poke restarts the
// timer, and when it finally fires the current value is sent only if it differs
// from the last one sent. A flap that settles where it started sends nothing.
// `read` may return undefined ("nothing to report right now"): nothing is sent
// and the last-sent value is kept.
export interface ReportDebouncerOptions<T, H = unknown> {
  delayMs: number;
  schedule: (fn: () => void, ms: number) => H;
  cancel: (handle: H) => void;
  read: () => T | undefined;
  send: (value: T) => void;
  /** The value the server already holds, when known (no report until it differs). */
  initial?: T;
}

export interface ReportDebouncer {
  poke(): void;
  dispose(): void;
}

export function createReportDebouncer<T, H = unknown>(options: ReportDebouncerOptions<T, H>): ReportDebouncer {
  let lastSent: T | undefined = options.initial;
  let pending: { handle: H } | null = null;
  let disposed = false;

  function fire(): void {
    pending = null;
    if (disposed) return;
    const value = options.read();
    if (value === undefined || value === lastSent) return;
    lastSent = value;
    options.send(value);
  }

  return {
    poke() {
      if (disposed) return;
      if (pending !== null) options.cancel(pending.handle);
      pending = { handle: options.schedule(fire, options.delayMs) };
    },
    dispose() {
      disposed = true;
      if (pending !== null) options.cancel(pending.handle);
      pending = null;
    },
  };
}
