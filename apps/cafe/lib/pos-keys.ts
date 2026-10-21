// U1 Task 5 (2026-10-21): the /pos keys (owner Q13; design 6.13; values 13.2 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md): "/" focuses the menu search, F8 presses Send KOT, F9 presses
// Pay. Pure, so the guard is tested without a browser (lib/pos-keys.test.ts); components/pos/PosKeys.tsx reads the page
// and acts on the answer.
//
// Stricter than the HTML on purpose (design 8: its F8 / F9 also fire while typing and over open sheets): a key never
// acts while a field has the focus, while a dialog, sheet or panel is open, on the keyboard's auto-repeat (a held F8
// sends once, plan Review Focus 4), or with a modifier held (Ctrl/Cmd/Alt + the key belongs to the browser or the
// system). F8 / F9 also need their button enabled and the cart not busy; "/" only focuses the search, which never locks.

export type PosKeyAction = "search" | "send" | "pay";

export interface PosKeyState {
  /** A dialog, sheet or panel is open (the cart sheet below 1024px aside, when it is the only one). */
  dialogOpen: boolean;
  /** An order write or a print is in flight, or a send is unconfirmed (usePosTab's isBusy). */
  busy: boolean;
  /** The visible Send KOT button is enabled. */
  sendEnabled: boolean;
  /** The visible Pay button is enabled. */
  payEnabled: boolean;
}

export interface PosKeyEvent {
  key: string;
  repeat: boolean;
  target: EventTarget | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/** The focus is in something that takes typing: a text field, a select, or an editable region. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!target) return false;
  const el = target as { tagName?: unknown; isContentEditable?: unknown };
  return (typeof el.tagName === "string" && FIELD_TAGS.has(el.tagName.toUpperCase())) || el.isContentEditable === true;
}

/** What a keydown on /pos should do, or null for nothing (the key then reaches the page as usual). */
export function posKeyAction(e: PosKeyEvent, s: PosKeyState): PosKeyAction | null {
  if (e.key !== "/" && e.key !== "F8" && e.key !== "F9") return null;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return null;
  if (s.dialogOpen || isTypingTarget(e.target)) return null;
  if (e.key === "/") return "search";
  if (s.busy) return null;
  if (e.key === "F8") return s.sendEnabled ? "send" : null;
  return s.payEnabled ? "pay" : null;
}
