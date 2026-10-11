import { ONE_DAY_MS } from "@pos/shared/public-promo";
import { cafeDateString } from "@pos/shared/utils";

// CB-7 S4 — the plain-English deadline under a scratch card ("Scratch by 12 Nov (3 days left)"). PURE. Days are the
// cafe's own (IST) calendar days via cafeDateString, never the device's zone — a diner abroad sees the cafe's day.

export const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export type DeadlineKind = "scratch" | "use";

const KIND_VERB: Readonly<Record<DeadlineKind, string>> = { scratch: "Scratch by", use: "Use by" };

// "2026-11-12" -> { dayMs: that day's UTC-midnight stamp, label: "12 Nov" }.
function dayOf(ms: number): { dayMs: number; label: string } {
  const key = cafeDateString(new Date(ms));
  const [year, month, day] = key.split("-").map(Number);
  return { dayMs: Date.UTC(year, month - 1, day), label: `${day} ${MONTHS_SHORT[month - 1]}` };
}

// The engine's expiry is strict (a card is still good AT its deadline instant), so "expired" means now is past it.
export function deadlineLine(kind: DeadlineKind, deadlineMs: number, nowMs: number): string {
  const deadline = dayOf(deadlineMs);
  if (nowMs > deadlineMs) return `Expired on ${deadline.label}`;
  const daysLeft = Math.round((deadline.dayMs - dayOf(nowMs).dayMs) / ONE_DAY_MS);
  const left = daysLeft <= 0 ? "last day" : daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
  return `${KIND_VERB[kind]} ${deadline.label} (${left})`;
}
