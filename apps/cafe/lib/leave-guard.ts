// Pure decision helpers for the in-app "Discard changes?" guard on Settings
// pages (hooks/use-in-app-leave-guard.ts owns the DOM/React side). No React, no
// DOM globals (types only) — everything here is unit-testable under node:test.

// Marks the extra history entry the guard pushes on the first edit, so a Back
// press can be told apart from an ordinary navigation.
export const LEAVE_GUARD_MARK = "__posLeaveGuard";

const PRIMARY_BUTTON = 0;
const SELF_TARGET = "_self";

export interface LeaveGuardClick {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

export interface LeaveGuardAnchor {
  href: string;
  target: string;
  download: boolean;
}

export type PopstateDecision = "ignore" | "prompt" | "continue-back";

export interface PopstateInput {
  // The full href of the entry we landed on equals the one we left.
  sameHref: boolean;
  state: unknown;
  dirty: boolean;
}

export interface HistoryPort {
  readonly state: unknown;
  readonly href: string;
  push(state: Record<string, unknown>, href: string): void;
  replace(state: Record<string, unknown>, href: string): void;
  back(): void;
}

export interface LeaveGuardHistory {
  setDirty(dirty: boolean): void;
  onPopState(state: unknown): void;
  onHashChange(): void;
  keepEditing(): void;
  leaveBack(): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isLeaveGuardEntry(state: unknown): boolean {
  return isObject(state) && state[LEAVE_GUARD_MARK] === true;
}

// The spread MUST keep Next's own keys (__NA, __PRIVATE_NEXTJS_INTERNALS_TREE):
// Next 15.5's patched history.pushState passes a state carrying __NA straight
// through without a router dispatch (app-router.js, the pushState patch), and
// its popstate handler reloads the page for a non-null state lacking __NA.
export function leaveGuardEntryState(state: unknown): Record<string, unknown> {
  return { ...(isObject(state) ? state : {}), [LEAVE_GUARD_MARK]: true };
}

// The destination (pathname + search + hash) for a click that would soft-leave
// the current page, else null. Cross-origin links are left to beforeunload;
// mailto:/tel:/javascript: have origin "null"; a hash-only change on the same
// pathname+search (the Bill print "See the bill" jump link) never leaves.
export function guardedLinkHref(
  click: LeaveGuardClick,
  anchor: LeaveGuardAnchor,
  here: string,
): string | null {
  if (click.button !== PRIMARY_BUTTON) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (click.defaultPrevented) return null;
  if (anchor.target !== "" && anchor.target !== SELF_TARGET) return null;
  if (anchor.download) return null;
  try {
    const dest = new URL(anchor.href);
    const current = new URL(here);
    if (dest.origin !== current.origin) return null;
    if (dest.pathname === current.pathname && dest.search === current.search) return null;
    return dest.pathname + dest.search + dest.hash;
  } catch {
    return null;
  }
}

// A "dead step" is a traversal between two history entries with the SAME full
// URL. Next never pushes two adjacent same-URL entries (app-router.js skips the
// push) and a same-URL fragment click replaces, so only OUR guard entry creates
// one — detecting it needs no mark, which is why a mark stripped by
// router.refresh() cannot confuse it. Known, accepted limit: a Forward onto a
// guard entry whose mark Next stripped reads as a Back.
export function popstateDecision(input: PopstateInput): PopstateDecision {
  if (!input.sameHref) return "ignore";
  // Fragment navigations carry a null state; Next ignores them too.
  if (!isObject(input.state)) return "ignore";
  // A Forward step onto a marked guard entry.
  if (isLeaveGuardEntry(input.state)) return "ignore";
  return input.dirty ? "prompt" : "continue-back";
}

// The history half of the guard, DOM-free behind a HistoryPort so a fake
// history can drive it. Lifecycle: the first dirty edit pushes a guard entry
// (same URL, marked); Back pops it onto the page's own entry and prompts; Keep
// editing pushes it again; once clean, a Back across the dead step just
// continues back. router.refresh() (every save) replaces the current entry with
// a fresh state and drops the mark, so while we believe we sit on a guard entry
// the next dirty edit RE-MARKS it in place instead of pushing a second one.
export function createLeaveGuardHistory(port: HistoryPort, onPrompt: () => void): LeaveGuardHistory {
  let lastHref = port.href;
  let onGuardEntry = isLeaveGuardEntry(port.state);
  let dirty = false;

  const pushGuardEntry = (): void => {
    port.push(leaveGuardEntryState(port.state), port.href);
    onGuardEntry = true;
  };

  return {
    setDirty(next) {
      dirty = next;
      if (!next) return;
      if (isLeaveGuardEntry(port.state)) {
        onGuardEntry = true;
        return;
      }
      if (onGuardEntry) port.replace(leaveGuardEntryState(port.state), port.href);
      else pushGuardEntry();
      lastHref = port.href;
    },
    onHashChange() {
      lastHref = port.href;
    },
    onPopState(state) {
      const sameHref = port.href === lastHref;
      lastHref = port.href;
      onGuardEntry = isLeaveGuardEntry(state);
      switch (popstateDecision({ sameHref, state, dirty })) {
        case "prompt":
          onPrompt();
          break;
        case "continue-back":
          port.back();
          break;
        case "ignore":
          break;
      }
    },
    keepEditing() {
      pushGuardEntry();
      lastHref = port.href;
    },
    // No bypass flag: a Back that is a no-op (first entry of the tab) fires no
    // popstate, so nothing may be left waiting for one.
    leaveBack() {
      dirty = false;
      port.back();
    },
  };
}
