import type { QueryClient } from "@tanstack/react-query";
import { NOW_SERVING_PATH } from "@/components/now-serving/NowServingLink";
import { ADMIN_ROUTES } from "@/lib/constants";
import { SCREEN_LOCK_STORAGE_KEY } from "./screen-lock-script";

// The screen lock's pure core: persisted state, the idle clock, the no-flash script and the scoped-query roots.
// The lock is a cover over the dashboard, never a sign-out; it survives a reload through localStorage.
// The storage key, the two <html> attributes and the no-flash script live in the import-free screen-lock-script.ts
// (the server layout reads that file alone) and are re-exported here.
export { SCREEN_LOCK_STORAGE_KEY, LOCK_ATTR, LOCK_READY_ATTR, SCREEN_LOCK_SCRIPT } from "./screen-lock-script";

export const SCREEN_LOCK_EVENT = "pos:screen-lock";

export type LockState = { locked: true; by: string | null; byName: string | null; at: number };

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;
type RemovableStorage = Pick<Storage, "removeItem">;

function stringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function readLockState(storage: ReadableStorage | null): LockState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SCREEN_LOCK_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const p = parsed as Record<string, unknown>;
    if (p.locked !== true) return null;
    if (typeof p.at !== "number" || !Number.isFinite(p.at)) return null;
    const by = p.by === undefined ? null : p.by;
    const byName = p.byName === undefined ? null : p.byName;
    if (!stringOrNull(by) || !stringOrNull(byName)) return null;
    return { locked: true, by, byName, at: p.at };
  } catch {
    return null;
  }
}

export function writeLockState(storage: WritableStorage | null, state: LockState): void {
  if (!storage) return;
  try {
    storage.setItem(SCREEN_LOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // private mode or a full disk: the in-memory lock still holds
  }
}

export function clearLockState(storage: RemovableStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(SCREEN_LOCK_STORAGE_KEY);
  } catch {
    // nothing to do
  }
}

// The wall-display pages never auto-lock: a kitchen or customer screen has nobody touching it.
const DISPLAY_PATHS: readonly string[] = ["/kitchen", NOW_SERVING_PATH];

export function isDisplayPath(pathname: string): boolean {
  return DISPLAY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function autoLockDue(input: {
  lastActivityAt: number;
  now: number;
  minutes: number;
  pathname: string;
}): boolean {
  if (!(input.minutes > 0)) return false;
  if (isDisplayPath(input.pathname)) return false;
  return input.now - input.lastActivityAt >= input.minutes * 60_000;
}

export function lockedAgoLabel(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "Locked · just now";
  if (minutes < 60) return `Locked · ${minutes} min ago`;
  return `Locked · ${Math.floor(minutes / 60)} h ago`;
}

/** The profile sheet's footer: the owner's HTML words (values 2.7) with the cafe's setting in minutes. */
export function screenLockLine(minutes: number): string {
  if (!(minutes > 0)) return "Auto-lock is off";
  return `Auto-locks after ${minutes} min without activity`;
}

/**
 * Where Tab (or Shift+Tab) goes inside the lock cover, so focus never leaves it: null means the browser's own move is
 * already inside (a control between the ends). `items` are the cover's focusable controls in document order; `order`
 * tells whether an item comes after (1) or before (-1) the focused element in the document (0: it is that element).
 * - From the first control, Shift+Tab wraps to the last; from the last, Tab wraps to the first.
 * - From anything else inside the cover that is not a listed control (the cover itself, the PIN pad's own region,
 *   which takes focus since ruling R34, plain text): Shift+Tab goes to the nearest control before it, else the last;
 *   Tab to the nearest control after it, else the first.
 */
export function coverTabTarget<T>(
  items: readonly T[],
  active: T | null,
  shift: boolean,
  order: (item: T) => -1 | 0 | 1,
): T | null {
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  if (active !== null && items.includes(active)) {
    if (shift && active === first) return last;
    if (!shift && active === last) return first;
    return null;
  }
  if (active === null) return shift ? last : first;
  if (shift) {
    const before = items.filter((item) => order(item) < 0);
    return before[before.length - 1] ?? last;
  }
  return items.find((item) => order(item) > 0) ?? first;
}

// The first key segment of each person-scoped query family (STAFF_KEYS, REPORT_KEYS, DASHBOARD_KEYS, EXPENSE_KEYS,
// TELEGRAM_KEYS, PRINT_DEVICES_KEYS), written as literals; screen-lock.test.ts compares them with the hooks.
export const PERSON_SCOPED_QUERY_ROOTS: readonly string[] = [
  "staff",
  "reports",
  "dashboard",
  "expenses",
  "telegram",
  "print-devices",
];

export function isPersonScopedQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  return typeof root === "string" && PERSON_SCOPED_QUERY_ROOTS.includes(root);
}

// ── Unlocking ───────────────────────────────────────────────────────────────

/** An admin-only page (ADMIN_ROUTES, exact or a sub-path), as the middleware reads it. */
export function isAdminPath(pathname: string): boolean {
  return ADMIN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Who an unlock signed in; null when the new session could not be read back. */
export type UnlockedPerson = { id: string; name: string | null; role: string | null } | null;

/**
 * What an unlock does. The person who was signed in when the cover opened just continues. Anyone else, or a session
 * that could not be read back, is a switch: the person-scoped data goes, an admin-only page is left for a non-admin
 * (an unknown role is not an admin), and a toast names the first name when there is one.
 */
export function unlockPlan(input: { before: string | null; next: UnlockedPerson; pathname: string }): {
  switched: boolean;
  redirectHome: boolean;
  toast: string | null;
} {
  const { before, next, pathname } = input;
  if (next !== null && next.id === before) return { switched: false, redirectHome: false, toast: null };
  return {
    switched: true,
    redirectHome: isAdminPath(pathname) && next?.role !== "admin",
    toast: next?.name ? `Signed in as ${firstName(next.name)}` : null,
  };
}

/**
 * A switch: the person-scoped queries go back to empty WITHOUT a request (Query.reset is state-only and cancels a
 * request in flight, which carries the last person's cookie). queryClient.resetQueries would also refetch the active
 * ones at once, as whoever the page under the cover still observes (the last person's multi-day dashboard, as the
 * new person). With `olderThan`, only queries holding data loaded before that time are cleared.
 */
export function clearPersonScopedQueries(client: QueryClient, olderThan?: number): void {
  for (const query of client.getQueryCache().findAll({ predicate: (q) => isPersonScopedQuery(q.queryKey) })) {
    if (olderThan === undefined || (query.state.data !== undefined && query.state.dataUpdatedAt < olderThan)) {
      query.reset();
    }
  }
}

/**
 * After the page's observers are on the new person's keys: the person-scoped queries still on screen load as the new
 * person. A request already in flight for a query with no data yet (an observer that just changed keys) is reused;
 * one in flight for a query holding data (a poll that may carry the last person's cookie) is cancelled and sent again.
 */
export function refetchPersonScopedQueries(client: QueryClient): Promise<void> {
  return client.refetchQueries({ predicate: (q) => isPersonScopedQuery(q.queryKey), type: "active" });
}

export function requestScreenLock(reason: "manual" | "switch"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCREEN_LOCK_EVENT, { detail: { reason } }));
}

// ── The shortcut (values 2.9: Ctrl/⌘+L locks the screen) ────────────────────

/** A key press, as much of one as the shortcut reads (a DOM KeyboardEvent fits). */
export interface LockShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  target: EventTarget | null;
  preventDefault(): void;
}

/** Typing in a field (an input, a text area, an editable block): Ctrl+L there belongs to the field. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === "string" ? el.tagName.toUpperCase() : "";
  return tag === "INPUT" || tag === "TEXTAREA";
}

/** Ctrl+L or ⌘L (with or without Shift, never with Alt) pressed outside a field. */
export function isLockShortcut(e: Omit<LockShortcutEvent, "preventDefault">): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "l" || e.key === "L") && !isTypingTarget(e.target);
}

/** Asks the cover for a manual lock on Ctrl/⌘+L, and keeps the browser's own Ctrl+L (the address bar) from firing. */
export function handleLockShortcut(e: LockShortcutEvent): boolean {
  if (!isLockShortcut(e)) return false;
  e.preventDefault();
  requestScreenLock("manual");
  return true;
}

/** The browser's platform name, or "" where there is no navigator (a server render). */
export function currentPlatform(): string {
  return typeof navigator === "undefined" || !navigator ? "" : (navigator.platform ?? "");
}

/** The shortcut chip on the profile sheet's Lock screen row: the platform's real key (ruling R7) — ⌘L on Apple devices
 *  (the HTML's chip), Ctrl L elsewhere (the cafe's Windows desks have no ⌘ key). */
export function lockShortcutLabel(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘L" : "Ctrl L";
}
