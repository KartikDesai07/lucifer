// CB-U1 — the wake poll's own per-device daily cap bookkeeping. Mirrors
// pos-device-prefs.ts's safe-read/write discipline: a print-host tab's
// localStorage is just as outside this app's control (another tab, a stale
// schema, a full quota truncating a write), so every access here is
// try/caught and a corrupt or missing value falls back to a fresh cafe-day
// record rather than throwing. Deliberately its OWN key, never a field on the
// device-prefs blob — repo memory shared-blob-whole-object-writers-clobber:
// a new field with a new writer turns every OTHER writer's mount-snapshot
// save into a silent reverter of this one.
const PRINT_WAKE_BUDGET_KEY = "pos.print-wake-budget.v1";

export interface PrintWakeBudget {
  dayKey: string;
  count: number;
}

/** Advances the budget by one hit. A null record OR a different `dayKey`
 *  (cafe-day rollover) starts a fresh count at 1, always allowed. Otherwise
 *  the count is clamped at `cap + 1` so a misbehaving tab can never grow the
 *  stored number unbounded — `allowed` still reflects the true count vs cap. */
export function bumpPrintWakeBudget(
  record: PrintWakeBudget | null,
  dayKey: string,
  cap: number,
): { record: PrintWakeBudget; allowed: boolean } {
  if (record === null || record.dayKey !== dayKey) {
    return { record: { dayKey, count: 1 }, allowed: true };
  }
  const nextCount = record.count + 1;
  const allowed = nextCount <= cap;
  return { record: { dayKey, count: Math.min(nextCount, cap + 1) }, allowed };
}

/** Merges the stored record with the hook's in-memory one: same dayKey ⇒ the
 *  HIGHER count wins (a storage that silently fails to persist can no longer
 *  reset the cap on every tick); different days ⇒ the record for `dayKey`
 *  if either has it, else null. Pure. */
export function mergePrintWakeBudget(
  stored: PrintWakeBudget | null,
  memory: PrintWakeBudget | null,
  dayKey: string,
): PrintWakeBudget | null {
  const storedForDay = stored !== null && stored.dayKey === dayKey ? stored : null;
  const memoryForDay = memory !== null && memory.dayKey === dayKey ? memory : null;
  if (storedForDay === null) return memoryForDay;
  if (memoryForDay === null) return storedForDay;
  return storedForDay.count >= memoryForDay.count ? storedForDay : memoryForDay;
}

/** Same normalisation discipline as pos-device-prefs.ts's normalizeDevicePrefs:
 *  typeof checks, Number.isFinite, count >= 0, a FRESH literal on success, and
 *  `null` on anything else — never throws, never returns the parsed object. */
function normalizePrintWakeBudget(v: unknown): PrintWakeBudget | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.dayKey !== "string") return null;
  if (typeof o.count !== "number" || !Number.isFinite(o.count) || o.count < 0) return null;
  return { dayKey: o.dayKey, count: o.count };
}

/** Reads this device's wake budget, falling back to `null` (fresh-record
 *  territory for the caller) on a missing, corrupt, or partially-shaped
 *  value — never throws. */
export function readPrintWakeBudget(): PrintWakeBudget | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PRINT_WAKE_BUDGET_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return normalizePrintWakeBudget(parsed);
  } catch {
    return null;
  }
}

/** Persists this device's wake budget. A quota-exceeded or disabled-storage
 *  failure is swallowed — the count simply resets to a fresh record next
 *  read rather than crashing the wake poll. */
export function writePrintWakeBudget(record: PrintWakeBudget): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PRINT_WAKE_BUDGET_KEY, JSON.stringify(record));
  } catch {
    // Quota exceeded or storage disabled — nothing persisted, nothing crashed.
  }
}
