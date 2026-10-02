import { nativeErrorCode } from "@/lib/printer/native-bridge";
import { nativeErrorMessage } from "@/lib/printer/transport-native";
import {
  PRINTER_NOT_CONNECTED_MESSAGE,
  PRINTER_WRITE_FAILED_MESSAGE,
  type PrinterSnapshot,
} from "@/lib/printer/web-printer-types";

// The write pipeline of the device printer: one job at a time (FIFO), one
// silent reconnect before the first send, and one resend ONLY after the native
// app explicitly refused before writing (NOT_CONNECTED). A failed write may
// already have printed part or all of a slip; replaying it duplicates orders.
// A hard deadline covers the whole job. The deadline is
// measured from ENQUEUE (time spent waiting behind another slip counts) and
// covers the reconnect and the resend; it stays under the 90 s host dispatch
// window together with the raster step.
export const DEVICE_WRITE_DEADLINE_MS = 70_000;
// How long the queue waits for a deadline's teardown (closing the link) before moving on.
export const WRITE_TEARDOWN_WAIT_MS = 5_000;

export interface WriteHost {
  requireOwner(): void;
  snapshot(): PrinterSnapshot;
  send(bytes: Uint8Array): Promise<void>;
  /** One silent reconnect (no chooser, no gesture). */
  reconnect(): Promise<boolean>;
  /** The link is not trustworthy any more: show it, and (web lanes) start the reconnect backoff. */
  markDisconnected(): void;
  /** A job ran out of time: mark the link down and close it so the write still in flight is torn down. */
  abort(): Promise<void>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

interface Job {
  enqueuedAt: number;
  started: boolean;
  /** Set when the deadline fired: nothing may be sent after this. */
  expired: boolean;
  /** Set when the deadline fired mid-job and the link is being torn down. */
  torn: Promise<void> | null;
}

export function createWriteQueue(host: WriteHost): (bytes: Uint8Array) => Promise<void> {
  let queue: Promise<unknown> = Promise.resolve();

  async function attempt(bytes: Uint8Array, job: Job): Promise<void> {
    if (host.snapshot().status !== "connected") {
      const reconnected = await host.reconnect();
      // The deadline already tore the link down (abort bumps the link generation, so a
      // reconnect still in flight is discarded and closed): never send after it.
      if (job.expired) throw new Error(PRINTER_WRITE_FAILED_MESSAGE);
      if (!reconnected) throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
    }
    try {
      return await host.send(bytes);
    } catch (first) {
      const code = nativeErrorCode(first);
      if (code !== "NOT_CONNECTED") {
        if (code === null || code === "WRITE_FAILED" || code === "TIMEOUT") host.markDisconnected();
        throw new Error(code === null ? PRINTER_WRITE_FAILED_MESSAGE : nativeErrorMessage(first));
      }
      if (job.expired || host.now() - job.enqueuedAt >= DEVICE_WRITE_DEADLINE_MS) throw new Error(PRINTER_WRITE_FAILED_MESSAGE);
      host.markDisconnected();
      const reconnected = await host.reconnect();
      if (job.expired || !reconnected) throw new Error(PRINTER_WRITE_FAILED_MESSAGE);
      try {
        return await host.send(bytes); // the ONE resend
      } catch {
        host.markDisconnected();
        throw new Error(PRINTER_WRITE_FAILED_MESSAGE);
      }
    }
  }

  async function run(bytes: Uint8Array, job: Job): Promise<void> {
    job.started = true;
    host.requireOwner();
    if (job.expired) throw new Error(PRINTER_WRITE_FAILED_MESSAGE);
    if (host.snapshot().printer === null) throw new Error(PRINTER_NOT_CONNECTED_MESSAGE);
    await attempt(bytes, job);
  }

  // The next job starts only after this one's teardown (bounded: a close that
  // never answers must not freeze the queue).
  function settleTeardown(job: Job): Promise<void> {
    if (job.torn === null) return Promise.resolve();
    let timer: unknown;
    const bound = new Promise<void>((resolve) => {
      timer = host.setTimer(resolve, WRITE_TEARDOWN_WAIT_MS);
    });
    return Promise.race([job.torn, bound]).finally(() => host.clearTimer(timer));
  }

  return (bytes) => {
    const job: Job = { enqueuedAt: host.now(), started: false, expired: false, torn: null };
    let deadline: unknown;
    const expired = new Promise<never>((_resolve, reject) => {
      deadline = host.setTimer(() => {
        job.expired = true;
        // A job still waiting its turn has touched nothing: there is nothing to tear down.
        if (job.started) job.torn = host.abort().catch(() => undefined);
        reject(new Error(PRINTER_WRITE_FAILED_MESSAGE));
      }, DEVICE_WRITE_DEADLINE_MS);
    });
    const previous = queue;
    const started = previous.then(() => run(bytes, job));
    const result = Promise.race([started, expired]).finally(() => host.clearTimer(deadline));
    // This slot ends after the previous one even when this job expired before it
    // started: the next job must never overtake an earlier job's teardown.
    queue = Promise.all([
      previous,
      result.then(
        () => settleTeardown(job),
        () => settleTeardown(job),
      ),
    ]);
    return result;
  };
}
