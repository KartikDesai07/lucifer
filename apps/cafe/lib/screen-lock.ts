import { NOW_SERVING_PATH } from "@/components/now-serving/NowServingLink";
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

export function screenLockLine(minutes: number): string {
  if (!(minutes > 0)) return "Screen lock is off";
  if (minutes < 60) return `Locks after ${minutes} minutes without activity`;
  const hours = Math.floor(minutes / 60);
  return `Locks after ${hours} ${hours === 1 ? "hour" : "hours"} without activity`;
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

export function requestScreenLock(reason: "manual" | "switch"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SCREEN_LOCK_EVENT, { detail: { reason } }));
}
