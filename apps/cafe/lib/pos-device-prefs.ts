// Per-DEVICE staff preferences for the CR2.3 §20 pulse alert — mirrors
// components/public/public-cart-store.ts's safe-read/write discipline (~lines
// 45-74): a staff terminal's localStorage is just as outside this app's
// control as a diner's browser (another tab, a stale schema, a full quota
// truncating a write), so every access here is try/caught and a corrupt or
// missing value falls back to defaults rather than throwing. Zero React —
// components own their own state and call these on mount / on every change,
// same split as public-cart-store.ts.
const DEVICE_PREFS_KEY = "pos.device-prefs.v1";

export interface PosDevicePrefs {
  // Auto-print a diner self-order's KOT the moment the pulse sees it accepted
  // — OFF by default: a device must be opted IN by staff before it starts
  // firing tickets on its own.
  autoPrintSelfOrders: boolean;
  // Ping on a new pending request / self-order arrival — ON by default (most
  // devices sit at a counter where staff want to hear it).
  alertSound: boolean;
  // This device is the designated print host (PH-5/PH-7 write it; the beat
  // clears it on an `isHost:false` answer). Read by the drain + §B6's
  // auto-print OR-gate.
  printHost: boolean;
  // This device has OBSERVED a configured host at least once. The ONLY
  // signal that lets an UNRESOLVED pulse (or a degraded `printHost:null`
  // tick) still attempt the enqueue instead of printing locally — plan §F /
  // design review MERGED-19.
  printHostSeen: boolean;
}

const DEFAULT_DEVICE_PREFS: PosDevicePrefs = {
  autoPrintSelfOrders: false,
  alertSound: true,
  printHost: false,
  printHostSeen: false,
};

/** Lenient by design: only the two ORIGINAL fields decide whether a stored
 * value is usable. The print-host fields are read with `Object.hasOwn` +
 * `=== true` (repo memory `object-literal-allowlist-prototype-keys` — an
 * object literal's own `constructor`/`toString` would otherwise sail through a
 * bare truthiness test) and default to false, so a pref written before PH-4
 * keeps its alertSound choice instead of silently resetting to defaults. A
 * type guard cannot do this: the two new members are REQUIRED, so every
 * already-stored value would fail it. Returns a FRESH literal — never the
 * parsed object — so no caller can hold a reference with extra keys on it. */
function normalizeDevicePrefs(v: unknown): PosDevicePrefs | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.autoPrintSelfOrders !== "boolean" || typeof o.alertSound !== "boolean") return null;
  return {
    autoPrintSelfOrders: o.autoPrintSelfOrders,
    alertSound: o.alertSound,
    printHost: Object.hasOwn(o, "printHost") && o.printHost === true,
    printHostSeen: Object.hasOwn(o, "printHostSeen") && o.printHostSeen === true,
  };
}

/** Reads this device's prefs, falling back to defaults on a missing, corrupt,
 * or partially-shaped value — never throws. */
export function readDevicePrefs(): PosDevicePrefs {
  if (typeof window === "undefined") return DEFAULT_DEVICE_PREFS;
  try {
    const raw = window.localStorage.getItem(DEVICE_PREFS_KEY);
    if (raw === null) return DEFAULT_DEVICE_PREFS;
    const parsed: unknown = JSON.parse(raw);
    return normalizeDevicePrefs(parsed) ?? DEFAULT_DEVICE_PREFS;
  } catch {
    return DEFAULT_DEVICE_PREFS;
  }
}

/** Persists this device's prefs. A quota-exceeded or disabled-storage
 * failure is swallowed — the toggle simply reverts to defaults next read
 * rather than crashing the settings screen. */
export function writeDevicePrefs(prefs: PosDevicePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEVICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota exceeded or storage disabled — nothing persisted, nothing crashed.
  }
}
