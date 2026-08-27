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
}

const DEFAULT_DEVICE_PREFS: PosDevicePrefs = {
  autoPrintSelfOrders: false,
  alertSound: true,
};

function isPosDevicePrefs(v: unknown): v is PosDevicePrefs {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PosDevicePrefs).autoPrintSelfOrders === "boolean" &&
    typeof (v as PosDevicePrefs).alertSound === "boolean"
  );
}

/** Reads this device's prefs, falling back to defaults on a missing, corrupt,
 * or partially-shaped value — never throws. */
export function readDevicePrefs(): PosDevicePrefs {
  if (typeof window === "undefined") return DEFAULT_DEVICE_PREFS;
  try {
    const raw = window.localStorage.getItem(DEVICE_PREFS_KEY);
    if (raw === null) return DEFAULT_DEVICE_PREFS;
    const parsed: unknown = JSON.parse(raw);
    return isPosDevicePrefs(parsed) ? parsed : DEFAULT_DEVICE_PREFS;
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
