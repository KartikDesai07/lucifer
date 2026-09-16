// Print-host plan (.claude/plan/v2/print-host-plan.md §B3/§B5, slice PH-4) —
// this device's own opaque identity, the value `PrintHost.deviceId` and every
// claim/beat CAS is keyed on. Zero React, and it mirrors pos-device-prefs.ts's
// safe-read/write discipline: a staff terminal's localStorage is as far outside
// this app's control as a diner's (another tab, a stale schema, a full quota
// truncating a write), so nothing here throws. NO CALLER YET, deliberately —
// PH-5's drain (claim + heartbeat, which must send the SAME id the host was
// designated with) and PH-7's designate-this-device action are the consumers.
const DEVICE_ID_KEY = "pos.device-id.v1";

// Resolved once per page session. Load-bearing when a WRITE fails (private
// mode, quota, storage disabled): without it every call would mint a fresh id,
// so PH-7's designation would store one value while PH-5's beat and claim sent
// others — the host would read as permanently offline while it was running, and
// every claim would answer not-host, so nothing would ever print. Never caches
// "" (a later successful read must still win).
let sessionDeviceId: string | null = null;

/** Fallback entropy when `crypto.randomUUID` is missing (below): 16 bytes render
 *  as 32 hex chars, under the server's 64-char PRINT_HOST_DEVICE_ID_MAX_CHARS. */
const DEVICE_ID_FALLBACK_BYTES = 16;
const HEX_RADIX = 16;
const HEX_PAD_WIDTH = 2;

/** `crypto.randomUUID` exists ONLY in a secure context and the cafe PC may well
 *  reach this app over plain http on the LAN, so `getRandomValues` (which works
 *  in insecure contexts too) carries the fallback. Gate on the method itself,
 *  not `window.isSecureContext` — a proxy for the cause, not the capability.
 *  Never a clock reading or a pseudo-random source: two tablets booted together
 *  would collide, and a colliding deviceId hands one device the other's host
 *  binding. (Named obliquely on purpose — `.claude/rules/testing.md`: the pin
 *  that forbids those globals here scans raw bytes, comments included.) */
function mintDeviceId(): string {
  if (typeof crypto === "undefined") return "";
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== "function") return "";
  const bytes = crypto.getRandomValues(new Uint8Array(DEVICE_ID_FALLBACK_BYTES));
  return Array.from(bytes, (b) => b.toString(HEX_RADIX).padStart(HEX_PAD_WIDTH, "0")).join("");
}

/** Fallback when no entropy source exists at all — one window is then
 *  indistinguishable from another in `claimedBy`, which only live legs read. */
const TAB_ID_FALLBACK = "tab";

/** PH-5 (§B5, MERGED-23): the per-MOUNT half of `claimedBy = deviceId:tabId`.
 *  Never persisted — two windows of one PC share the stored deviceId and are
 *  told apart by this alone. Same entropy discipline as the device id. */
export function mintTabId(): string {
  const minted = mintDeviceId();
  return minted === "" ? TAB_ID_FALLBACK : minted;
}

/** This device's opaque, stable id (created on first read). "" when storage is
 *  unavailable or we are on the server — callers must treat "" as "no identity". */
export function readDeviceId(): string {
  if (typeof window === "undefined") return "";
  if (sessionDeviceId !== null) return sessionDeviceId;
  // Stored as a RAW string, not JSON: a JSON.parse of a bare uuid throws, and
  // this module swallows throws — a JSON round-trip would silently re-mint on
  // every read, breaking the "stable" half of the contract.
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (typeof existing === "string" && existing !== "") {
      sessionDeviceId = existing;
      return existing;
    }
  } catch {
    // Storage disabled — fall through to an in-memory id for this session.
  }

  const minted = mintDeviceId();
  if (minted === "") return "";
  sessionDeviceId = minted;
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, minted);
  } catch {
    // Returned anyway: an identity lasting only this session still lets the
    // drain claim and beat, where "" refuses every claim outright.
  }
  return minted;
}
