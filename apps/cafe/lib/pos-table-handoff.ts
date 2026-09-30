// One-shot hand-off of a table from the Tables floor to New Order (Tables
// redesign, 2026-09-30). NOT a URL parameter: Next 15 serves "/pos?table=…"
// from the warm "/pos" prefetch only as an ALIASED entry (loading state only —
// node_modules/next/dist/client/components/router-reducer/prefetch-cache-utils.js)
// and fetches the page again, one round trip per tap on a slow line. A plain
// "/pos" link reuses the warm prefetch; the table rides in this tab's session
// store instead. Read-and-removed on New Order's mount, so a refresh, Back or a
// later visit never re-applies it; expires so an abandoned tap is never used.
// Client-safe, no React. Storage can be missing or throw (private mode, blocked
// site data): every access is guarded and a failure simply means "no table".
import { TABLE_NO_MAX_LEN, TABLE_NO_PATTERN } from "@/lib/constants";

export const POS_TABLE_HANDOFF_KEY = "pos.tableHandoff";
// Covers a cold navigation on a slow line; an abandoned tap (navigation
// cancelled before New Order opened) is gone after this, so a later, unrelated
// New Order within the window is the only residual — and its table chip shows it.
export const POS_TABLE_HANDOFF_TTL_MS = 15_000;

interface StoredHandoff {
  tableNo: string;
  at: number;
}

function isValidTableNo(value: unknown): value is string {
  return typeof value === "string" && value.length <= TABLE_NO_MAX_LEN && TABLE_NO_PATTERN.test(value);
}

/** Parses a stored hand-off; null unless the name is a valid table name and
 *  it was written no more than the TTL ago (a future stamp is rejected too). */
export function parsePosTableHandoff(raw: string | null, nowMs: number): string | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { tableNo, at } = value as Partial<StoredHandoff>;
  if (!isValidTableNo(tableNo) || typeof at !== "number" || !Number.isFinite(at)) return null;
  const age = nowMs - at;
  return age >= 0 && age <= POS_TABLE_HANDOFF_TTL_MS ? tableNo : null;
}

export function offerPosTable(tableNo: string, nowMs: number): void {
  if (!isValidTableNo(tableNo)) return;
  try {
    const stored: StoredHandoff = { tableNo, at: nowMs };
    window.sessionStorage.setItem(POS_TABLE_HANDOFF_KEY, JSON.stringify(stored));
  } catch {
    // No session store: New Order simply opens without a table picked.
  }
}

/** Reads AND removes the hand-off (always removed, valid or not). */
export function takePosTableHandoff(nowMs: number): string | null {
  try {
    const raw = window.sessionStorage.getItem(POS_TABLE_HANDOFF_KEY);
    window.sessionStorage.removeItem(POS_TABLE_HANDOFF_KEY);
    return parsePosTableHandoff(raw, nowMs);
  } catch {
    return null;
  }
}
