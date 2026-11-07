// P2 N4: when may an open page load a newer build by itself? Only at a quiet moment, when nobody can lose anything:
// the screen lock is on, or a minute passed with no pointer or key input, AND no dialog or sheet is open, no text
// field has focus, the POS cart is empty, nothing unsent is held (lib/page-refresh.ts), no order waits in the offline
// outbox, no write is in flight, this device holds no print job (lib/print-host-busy.ts) and the device is online.
// The lock is a quiet moment, but it never overrides any of the others: a payment left open under it still waits.
// A plain browser with alerts on never reloads by itself: after a reload its alarm sound and the Now Serving voice
// stay locked until someone taps (lib/alert-sound.ts), so it shows the header's chip and staff reload with a tap.
// The chip also stands in once this page already reloaded toward this build and still runs the old one (a CDN or a
// deploy skew), so a device never reloads itself in a loop. Pure: the DOM facts take a minimal document (tested
// with fakes); components/layout/UpdateWhenQuiet.tsx gathers the facts every few seconds and acts on the verdict.

import { DIALOG_ROLE_SELECTOR } from "@/lib/nested-dialog";

/** A minute with no pointer or key input counts as quiet. */
export const QUIET_IDLE_MS = 60_000;
/** The "Updated" note after the reload. */
export const UPDATED_NOTE_MS = 2000;
/** How often the page looks for its quiet moment, only while a newer build waits (a local timer, no request). */
export const UPDATE_CHECK_MS = 5000;
/** The header chip's words (and its accessible name). */
export const UPDATE_READY_LABEL = "Update ready · Reload";
/** sessionStorage: the server build a reload goes to (the loop guard and the "Updated" note). */
export const UPDATE_RELOAD_KEY = "pos.update.reload";

export interface QuietFacts {
  /** A newer build waits (lib/update-pending.ts). */
  pending: boolean;
  /** The screen lock covers the page. */
  locked: boolean;
  msSinceInput: number;
  /** A dialog or sheet other than the lock's own cover. */
  dialogOpen: boolean;
  textFocused: boolean;
  /** Lines in the POS cart, fired or not. */
  cartItems: number;
  /** Work a reload loses: unsent lines, an order being sent or not confirmed, a dirty form. */
  unsentWork: boolean;
  /** Orders waiting in the offline outbox. */
  outbox: number;
  /** Writes in flight (TanStack isMutating). */
  mutating: number;
  /** This device leases or prints a job. */
  printBusy: boolean;
  /** A reload would lock this device's alert sound until a tap. */
  soundNeedsGesture: boolean;
  /** This page has no reach to the server (lib/server-reach.ts) or the browser says it is offline. */
  offline: boolean;
  /** This page already reloaded toward the server's build and still runs the old one. */
  autoReloadSpent: boolean;
}

export type QuietVerdict = "wait" | "reload" | "chip";

export function quietVerdict(s: QuietFacts): QuietVerdict {
  if (!s.pending) return "wait";
  if (s.soundNeedsGesture) return "chip";
  if (s.autoReloadSpent) return "chip";
  // Offline, a reload swaps the POS for the browser's "no internet" page (or the app's error screen), and that device
  // takes no offline KOT until someone taps Retry. The chip above still shows: a tap on it is staff's own choice, and
  // Refresh's rule refuses it offline with the same reading (hooks/use-ask-first-reload.ts, R59).
  if (s.offline) return "wait";
  const quiet = s.locked || s.msSinceInput >= QUIET_IDLE_MS;
  const nothingToLose =
    !s.dialogOpen &&
    !s.textFocused &&
    s.cartItems === 0 &&
    !s.unsentWork &&
    s.outbox === 0 &&
    s.mutating === 0 &&
    !s.printBusy;
  return quiet && nothingToLose ? "reload" : "wait";
}

/** An earlier reload of this tab went to `stored` and still landed on the old build (so it keeps the chip), and the
 *  server now reports another valid build: the server moved on, so the key is forgotten and a later report of that
 *  build earns one quiet reload again. */
export function staleReloadTarget(stored: string | null, serverBuild: string | null): boolean {
  return stored !== null && serverBuild !== null && serverBuild !== "" && serverBuild !== stored;
}

/** The parts of the document the two DOM facts read. */
export interface QuietDocument {
  querySelectorAll(selector: string): ArrayLike<QuietDialog>;
  activeElement: QuietFocused | null;
}
interface QuietDialog {
  closest(selector: string): unknown;
  getAttribute(name: string): string | null;
}
interface QuietFocused {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/** An open dialog or sheet that is not the screen lock's cover (role="dialog" itself) nor inside it. Radix unmounts a
 *  closed dialog; one on its way out (data-state="closed") or hidden never counts either. */
export function dialogOpenIn(doc: QuietDocument): boolean {
  return Array.from(doc.querySelectorAll(DIALOG_ROLE_SELECTOR)).some(
    (el) => el.closest("[data-screen-lock]") == null && el.closest("[hidden]") == null && el.getAttribute("data-state") !== "closed",
  );
}

/** Input types nobody types into. */
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image", "hidden"]);

/** Someone may be typing: the focused element is an editable text field anywhere, the lock's password form included. */
export function textFieldFocused(doc: QuietDocument): boolean {
  const el = doc.activeElement;
  if (el === null) return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !NOT_TYPED.has((el.type ?? "text").toLowerCase());
}
