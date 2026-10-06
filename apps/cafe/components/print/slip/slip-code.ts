import type { SlipCode } from "./slip-code-lazy";

// R6 (01-PLAN A4): the slip code most cafes never run (the non-Classic designs and the QR encoder) is one lazy
// chunk, slip-code-lazy.ts, fetched only when a saved template needs it. This module is its eager side: the
// memoized loader and the status store the receipts (slip-view.ts) and the print host subscribe to. It imports no
// React: the print host's hooks run under lib/hook-harness.ts, whose fake React has no context. A cafe with no
// template (or a Classic one with no QR line) never fetches the chunk, and its receipts render exactly as before.
//
// Nothing waits between a print's trigger and react-to-print's clone (the clone stays synchronous): a receipt on a
// PRINT surface renders its legacy slip until the chunk is in, so whatever is cloned is a whole slip of the right
// order, never a blank one. The print host, which prints queued jobs, holds its dispatch until the chunk has loaded
// or failed, at most SLIP_CODE_WAIT_MAX_MS (hooks/use-slip-code-pending.ts), so a host that boots with jobs waiting
// prints them in the design. Only an on-screen preview (<SlipPreview>) shows a skeleton meanwhile (slip-view.ts).

/** "idle": never asked. "loading": in flight. "ready": loaded. "failed": the last fetch failed (legacy slip prints). */
export type SlipCodeStatus = "idle" | "loading" | "ready" | "failed";

type SlipCodeImport = () => Promise<{ SLIP_CODE: SlipCode }>;

let importSlipCode: SlipCodeImport = () => import("./slip-code-lazy");
let code: SlipCode | null = null;
let status: SlipCodeStatus = "idle";
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setStatus(next: SlipCodeStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

/** Test seam (node:test makes the fetch fail): replaces the chunk's import. */
export function setSlipCodeImport(next: SlipCodeImport): void {
  importSlipCode = next;
}

/**
 * Fetches the lazy chunk once: joins a fetch in flight, and after a failure the next call fetches again. Never
 * rejects. It notifies subscribers synchronously, so call it from an effect, never in render.
 */
export function loadSlipCode(): Promise<void> {
  if (code !== null) return Promise.resolve();
  if (pending !== null) return pending;
  pending = importSlipCode().then(
    (mod) => {
      code = mod.SLIP_CODE;
      pending = null;
      setStatus("ready");
    },
    () => {
      pending = null;
      setStatus("failed");
    },
  );
  setStatus("loading");
  return pending;
}

/** The loaded chunk, or null. Its renderers run only after a receipt's useSlipView (slip-view.ts) said "slip". */
export function loadedSlipCode(): SlipCode | null {
  return code;
}

export function slipCodeStatus(): SlipCodeStatus {
  return status;
}

export function subscribeSlipCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether a template prints through the lazy chunk: any design but Classic, or any QR line (the encoder is in it). */
export function templateNeedsSlipCode(template: { design: string; blocks: readonly { type: string }[] }): boolean {
  return template.design !== "classic" || template.blocks.some((block) => block.type === "qr");
}

/** Whether a token slip needs the lazy chunk: only for a QR line (the encoder is in it). Its designs are eager (S7). */
export function tokenTemplateNeedsSlipCode(template: { blocks: readonly { type: string }[] }): boolean {
  return template.blocks.some((block) => block.type === "qr");
}
