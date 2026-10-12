import type { CartLine, PublicIdentity } from "@/components/public/public-cart-store";

// The localStorage IO helpers and shape guards behind public-cart-store.ts,
// split out of it (S5a, behaviour-preserving move) so that file stays under the
// 300-line budget. Zero React, SSR-safe. Storage KEYS stay in public-cart-store.ts.

// Every read tolerates a corrupt or absent value — a diner's browser storage
// is outside this app's control (another tab, a stale schema, a full quota
// truncating a write) and must never throw and crash the menu page.
export function safeRead<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function safeWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — the diner keeps ordering with an
    // in-memory-only cart for this session rather than crashing the page.
  }
}

export function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage disabled — nothing was persisted to begin with.
  }
}

export function isCartLineArray(v: unknown): v is CartLine[] {
  return (
    Array.isArray(v) &&
    v.every(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        typeof (line as CartLine).lineId === "string" &&
        typeof (line as CartLine).productId === "string" &&
        typeof (line as CartLine).qty === "number",
    )
  );
}

export function isIdentity(v: unknown): v is PublicIdentity {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PublicIdentity).mobile === "string" &&
    typeof (v as PublicIdentity).name === "string"
  );
}

export function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((c) => typeof c === "string");
}

export function isRefreshMap(v: unknown): v is Record<string, number> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((at) => typeof at === "number")
  );
}

export interface MenuCacheEntry {
  at: number;
  payload: unknown;
}

// `payload` is deliberately opaque (unknown) — this module never interprets
// the public menu shape, only the envelope around it — so validation checks
// only the envelope's own fields.
export function isMenuCacheEntry(v: unknown): v is MenuCacheEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as MenuCacheEntry).at === "number" &&
    "payload" in v
  );
}
