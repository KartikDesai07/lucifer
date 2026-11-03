import { keptTakenAt, type OfflineRound } from "@pos/shared/offline-kot";
import { rupeesToPaise } from "@pos/shared/codec";
import { slipDayKey } from "@pos/shared/slip-day";
import { cafeDateString, inrPaise } from "@pos/shared/utils";
import type { PrintConfig } from "@/lib/print";

// Printing Phase 5 (spec 2026-11-03 §5.9): the pure rules of an order request that carries the `offline` field (a
// round taken while the device could not reach the server; its KOT already printed on the device, "OFFLINE · O-3").
// Job creation asks offlineVerdictOf for every routed KOT line; the two order routes keep the taken time only on the
// arrival's day, refuse an offline sale whose total changed, and echo the field so the device knows it was read.
// The request-facing helpers (offlineAskOf, the replay) are in print-offline-replay.ts. Never touches the DB.

/** The field and the device that sent it (`x-pos-device-id`, required with the field). */
export type OfflineAsk = { round: OfflineRound; deviceId: string };
export type OfflineVerdict = "printed" | "reprint" | "new";

/** Simple mode's one line: the whole KOT on the device that prints it. Printers mode's full copy is "all". */
const DEVICE_PART = "-";
const ALL_PART = "all";

/** What a routed KOT line becomes (spec §5.9): printed when the device printed this very line; a REPRINT when paper
 *  may be out for it (this line "maybe", or its station covered by another line that printed or may have printed:
 *  the setup changed during the outage); else made as today. A full copy, and simple mode's whole ticket, cover every
 *  station, so a station line they printed is a REPRINT, and so is a whole ticket after any station line printed. */
export function offlineVerdictOf(
  line: { printerId: string | null; part: string; targetDeviceId: string },
  ask: OfflineAsk | undefined,
): OfflineVerdict {
  if (ask === undefined) return "new";
  const lines = ask.round.lines;
  const exact = lines.find((l) => l.printerId === line.printerId && l.part === line.part);
  if (exact !== undefined) {
    if (exact.outcome === "later") return "new";
    if (exact.outcome === "maybe") return "reprint";
    // Simple mode: printed on the asking device; a host that prints it now would print it a second time.
    return line.printerId === null && line.targetDeviceId !== ask.deviceId ? "reprint" : "printed";
  }
  const out = lines.filter((l) => l.outcome !== "later");
  const whole = line.part === DEVICE_PART || line.part === ALL_PART;
  if (whole && line.printerId === null) return out.length > 0 ? "reprint" : "new";
  if (whole) return out.some((l) => l.part === DEVICE_PART) ? "reprint" : "new";
  return out.some((l) => l.part === line.part || l.part === ALL_PART || l.part === DEVICE_PART) ? "reprint" : "new";
}

/** The taken time when it lies inside the window (12 h back, 5 min ahead) AND on the arrival's cafe day and every
 *  numbered series' slip day: every number is drawn when the request arrives, so a time from another day would
 *  carry that day's numbers (the planning review's C1; the re-check's N4). Else null: the server's time. */
export function offlineKeptTime(takenAt: number, nowMs: number, resetMinutesOf: readonly number[]): number | null {
  const kept = keptTakenAt(takenAt, nowMs);
  if (kept === null) return null;
  const taken = new Date(kept);
  const now = new Date(nowMs);
  if (cafeDateString(taken) !== cafeDateString(now)) return null;
  return resetMinutesOf.every((reset) => slipDayKey(taken, reset) === slipDayKey(now, reset)) ? kept : null;
}

/** offlineKeptTime for a route: null without the field. The resets are the bill's, the KOT's and the token's. */
export function offlineKeptAt(offline: OfflineRound | undefined, cfg: PrintConfig, nowMs: number): number | null {
  if (offline === undefined) return null;
  return offlineKeptTime(offline.takenAt, nowMs, [cfg.bill.resetMinutes, cfg.kot.resetMinutes, cfg.token.resetMinutes]);
}

const money = (rupees: number): string => inrPaise(rupeesToPaise(rupees)).replace(/\.00$/, "");

/** An offline sale (Pay Now) whose server total differs from the total the device took is refused (409), so a paid
 *  amount the drawer does not hold is never recorded (spec §5.6). null: online, a round, an open tab, or equal. */
export function offlineSaleTotalRefusal(serverTotal: number, offline: OfflineRound | undefined, status: string): string | null {
  if (offline?.total === undefined || status !== "Completed") return null;
  if (rupeesToPaise(serverTotal) === rupeesToPaise(offline.total)) return null;
  return `The total is now ${money(serverTotal)}; this device took ${money(offline.total)}.`;
}

/** The answer's echo (the review's m4): a device whose replay answer lacks it knows the server dropped the field. */
export function withOfflineEcho<T>(body: T, offline: OfflineRound | undefined, kept: number | null): T | (T & { offline: { ref: string; takenAtKept: boolean } }) {
  return offline === undefined ? body : { ...body, offline: { ref: offline.ref, takenAtKept: kept !== null } };
}

/** The log detail of a job an offline round made: "offline O-3". */
export function offlineDetailOf(ref: string): string {
  return `offline ${ref}`;
}

/** What insertPrintJob makes of a verdict that is not "new". */
export function offlineInsertOf(
  verdict: Exclude<OfflineVerdict, "new">,
  ask: OfflineAsk,
): { verdict: "printed"; deviceId: string; detail: string } | { verdict: "reprint" } {
  return verdict === "printed" ? { verdict, deviceId: ask.deviceId, detail: offlineDetailOf(ask.round.ref) } : { verdict };
}
