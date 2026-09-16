import { isDuplicateKeyError } from "@pos/shared/api";
import { PRINT_HOST_KEY, printHostOffline, type PrintHostState } from "@pos/shared/print-job";
import { PrintHost } from "@/models/PrintHost";

// Print-host plan (.claude/plan/v2/print-host-plan.md §B3) — the PrintHost
// singleton: designate/clear/beat, plus the pure state mapper the pulse route
// (§B4) and PUT/DELETE/beat routes all share. Never calls connectDB() — every
// route caller does that first, per repo convention (order-request-intake.ts,
// pos-pulse.ts). No console.*, strict TS, no `any`.

/** An opaque `crypto.randomUUID()` is 36 chars — fenced generously above that. */
export const PRINT_HOST_DEVICE_ID_MAX_CHARS = 64;
/** UI-only staff label ("Counter PC"). */
export const PRINT_HOST_LABEL_MAX_CHARS = 60;

/**
 * ROLLOUT FENCE (CB-1d.1 close-out, 2026-09-03 — owner decision), OPENED by
 * PH-8 (2026-09-06). The PS-A wizard made `PUT /api/print-host` the first
 * REACHABLE designation trigger while PH-5 (host drain) and PH-8 (in-flight
 * disable + readback) were unbuilt, so PUT refused every designation with
 * PRINT_HOST_DESIGNATION_CLOSED_ERROR — after auth, before body validation and
 * connectDB(). Both slices have shipped, so designation is live. The branch
 * and its ordering pin (lib/print-queue.test.ts §16b) are KEPT so re-closing
 * the fence is this one literal, not a route rewrite. DELETE never consults
 * it (clearing a host is always safe). Server-only by construction: this
 * module imports the Mongoose model, so the flag can never leak into a client
 * bundle. Flip + pin in the same edit, always.
 */
export const PRINT_HOST_DESIGNATION_ENABLED = true;
/** Staff-facing refusal copy — generic product voice, never a cafe name. */
export const PRINT_HOST_DESIGNATION_CLOSED_ERROR =
  "Print host designation is not enabled yet — it arrives in the next update. You can install the shortcut and finish the other steps now.";

/**
 * Pure: maps the stored singleton (or its absence) to the wire shape. `offline`
 * is computed from the SERVER clock here, never a client's own (MERGED-15) —
 * a caller passing its own `Date.now()` would inflate the verdict by however
 * stale that caller's own read is.
 */
export function printHostStateOf(
  host: { deviceId: string; label: string; lastSeenAt: Date; silentMode?: boolean } | null,
  nowMs: number,
): PrintHostState {
  if (host === null) {
    // `configured` derives from document ABSENCE only (§F) — no separate flag.
    return { configured: false, deviceId: null, label: null, lastSeenAt: null, offline: true, silentMode: false };
  }
  const lastSeenAtIso = host.lastSeenAt.toISOString();
  return {
    configured: true,
    deviceId: host.deviceId,
    label: host.label,
    lastSeenAt: lastSeenAtIso,
    offline: printHostOffline(lastSeenAtIso, nowMs),
    // Strict `=== true` (object-literal-allow-list prototype-key lesson) — a
    // lean doc's `silentMode` is `undefined` unless explicitly set to `true`.
    silentMode: host.silentMode === true,
    // silentProbeMs is deliberately NOT read/mapped here — server-side only (§B4).
  };
}

/** `PrintHost.findOne` selected down to exactly what `printHostStateOf` reads. */
export async function readPrintHostState(nowMs: number): Promise<PrintHostState> {
  const host = await PrintHost.findOne({ key: PRINT_HOST_KEY })
    .select("deviceId label lastSeenAt silentMode")
    .lean();
  return printHostStateOf(host, nowMs);
}

export type DesignatePrintHostResult = { ok: true; state: PrintHostState } | { ok: false; reason: "raced" };

/**
 * Designating REPLACES the previous host — that IS the "one host" rule (§B3).
 * `setBy` comes from the argument (the route reads it from the session),
 * never from a request body.
 */
export async function designatePrintHost(
  input: { deviceId: string; label: string; setBy: string },
  nowMs: number,
): Promise<DesignatePrintHostResult> {
  const runDesignate = () =>
    PrintHost.findOneAndUpdate(
      { key: PRINT_HOST_KEY },
      {
        // $set-only (never $setOnInsert): Mongo rejects one field living in
        // both operators on the same write, and $set already covers the
        // insert branch of this upsert — no need for a separate clause.
        $set: {
          deviceId: input.deviceId,
          label: input.label,
          setBy: input.setBy,
          setAt: new Date(nowMs),
          lastSeenAt: new Date(nowMs),
        },
        // $set and $unset touch disjoint fields (identity vs. silent-probe
        // state) so combining them in one update is safe. Designation always
        // clears whatever silent-mode attestation the PREVIOUS host earned —
        // a brand-new host device has not attested anything yet.
        $unset: { silentMode: "", silentProbeMs: "" },
      },
      { new: true, upsert: true, runValidators: true },
    )
      .select("deviceId label lastSeenAt silentMode")
      .lean();

  try {
    const host = await runDesignate();
    return { ok: true, state: printHostStateOf(host, nowMs) };
  } catch (error) {
    // Two racing upserts against the unique {key:1} can both miss Mongo's
    // pre-check and both attempt an insert; exactly one wins, the other
    // throws E11000. Retrying the SAME call once now matches the winner's
    // doc (an update, not an insert) and succeeds. A second E11000 would mean
    // something stranger than an ordinary two-way race — surface it instead
    // of looping.
    if (!isDuplicateKeyError(error)) throw error;
    try {
      const host = await runDesignate();
      return { ok: true, state: printHostStateOf(host, nowMs) };
    } catch (retryError) {
      if (!isDuplicateKeyError(retryError)) throw retryError;
      return { ok: false, reason: "raced" };
    }
  }
}

/** `configured` derives from document ABSENCE only (§F) — no flag to flip. */
export async function clearPrintHost(): Promise<{ cleared: boolean }> {
  const res = await PrintHost.deleteOne({ key: PRINT_HOST_KEY });
  return { cleared: (res.deletedCount ?? 0) > 0 };
}

export type BeatPrintHostResult = { isHost: true; state: PrintHostState } | { isHost: false };

/**
 * CAS heartbeat. The `deviceId` term in the filter (MERGED-07) is what stops
 * a DEMOTED device's stale beat from resurrecting the `silentMode`/
 * `silentProbeMs` that a later designation's $unset already cleared — without
 * it, a beat in flight from the old host at the moment of redesignation could
 * land after the $unset and silently restamp fields for the WRONG device.
 */
export async function beatPrintHost(
  input: { deviceId: string; silentMode?: boolean; silentProbeMs?: number },
  nowMs: number,
): Promise<BeatPrintHostResult> {
  const host = await PrintHost.findOneAndUpdate(
    { key: PRINT_HOST_KEY, deviceId: input.deviceId },
    {
      $set: {
        lastSeenAt: new Date(nowMs),
        // Omit-empty: only stamp a silent-probe field when THIS beat actually
        // carries one — an absent field must never overwrite a prior
        // attestation with undefined/false noise.
        ...(input.silentMode !== undefined ? { silentMode: input.silentMode } : {}),
        ...(input.silentProbeMs !== undefined ? { silentProbeMs: input.silentProbeMs } : {}),
      },
    },
    { new: true },
  )
    .select("deviceId label lastSeenAt silentMode")
    .lean();

  // A null result means "not the host" (wrong/no device, or no host
  // configured at all) — CHECKED, never re-read: this beat wrote NOTHING, so
  // there is nothing to report back except the negative.
  if (!host) return { isHost: false };
  return { isHost: true, state: printHostStateOf(host, nowMs) };
}
