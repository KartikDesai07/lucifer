import { z } from "zod";

// Printing Phase 5 (spec 2026-11-03 §5.4, §5.9): a round taken while the device could not reach the server.
// Its KOT prints at once on the printers this device prints, with the banner "OFFLINE · O-3" (O-n counts per
// device per cafe day); when the server answers again the round is sent under its own key with this field, so
// the server saves the lines printed offline as printed and never prints them twice.

export const OFFLINE_LABEL = "OFFLINE";
export const OFFLINE_REF_RE = /^O-[1-9][0-9]{0,3}$/;
export const OFFLINE_REF_MAX = 9999;
export const OFFLINE_LINES_MAX = 24;
/** The taken time is kept only inside this window (P5-9); else the server's time and a note. */
export const OFFLINE_TAKEN_MAX_AGE_MS = 12 * 60 * 60 * 1000;
export const OFFLINE_TAKEN_MAX_AHEAD_MS = 5 * 60 * 1000;

export const OFFLINE_OUTCOMES = ["printed", "maybe", "later"] as const;
export type OfflineOutcome = (typeof OFFLINE_OUTCOMES)[number];

/** One routed KOT line of the round: printers mode names its printer and part (a station id or "all");
 *  simple mode's device line is `{ printerId: null, part: "-" }`. */
export const offlineLineSchema = z
  .object({
    printerId: z.string().min(1).max(64).nullable(),
    part: z.string().min(1).max(64),
    outcome: z.enum(OFFLINE_OUTCOMES),
  })
  .strict();

export const offlineRoundSchema = z
  .object({
    ref: z.string().regex(OFFLINE_REF_RE),
    takenAt: z.number().int().positive(),
    /** A sale only: the total the device took (the server refuses the sale when its own total differs). */
    total: z.number().min(0).optional(),
    lines: z.array(offlineLineSchema).max(OFFLINE_LINES_MAX),
  })
  .strict();

export type OfflineLine = z.infer<typeof offlineLineSchema>;
export type OfflineRound = z.infer<typeof offlineRoundSchema>;

/** "O-<n>" for n in 1..9999. */
export function offlineRefOf(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > OFFLINE_REF_MAX) throw new RangeError(`offline number out of range: ${n}`);
  return `O-${n}`;
}

/** The KOT's banner: "OFFLINE · O-3" (U+00B7, the middle dot REPRINT's joined labels use; a text KOT maps it to "-":
 *  apps/cafe/lib/printer/kot-text/text-chars.ts, so it prints "OFFLINE - O-3"). */
export function offlineBannerOf(ref: string): string {
  return `${OFFLINE_LABEL} · ${ref}`;
}

/** The taken time when it lies within the last 12 hours and at most 5 minutes ahead; else null. */
export function keptTakenAt(takenAt: number, nowMs: number): number | null {
  if (takenAt < nowMs - OFFLINE_TAKEN_MAX_AGE_MS) return null;
  if (takenAt > nowMs + OFFLINE_TAKEN_MAX_AHEAD_MS) return null;
  return takenAt;
}
