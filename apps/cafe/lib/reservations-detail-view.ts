// The booking detail's words and states (U6 Task 3, 2026-11-03; values 10.3 / 10.4 / 19.4; design 7, B11, B19), pure: the
// sub-line, the time banner, the three steps, the table fact and the history fact, so the component only draws and the
// tests pin them with fixed clocks. Our four statuses (Booked / Seated / Completed / Cancelled): the HTML's Confirmed step
// and No-show are not ours.
import { cafeDateString } from "@pos/shared/utils";

import { clockOf, relativeOf, shortDay, type ResTone } from "@/lib/reservations-view";
import type { Reservation, Table } from "@/types";

/** "2 guests · Tue, 3 Nov · 7:00 PM". */
export function detailSub(r: Reservation): string {
  return `${r.guests} guest${r.guests === 1 ? "" : "s"} · ${shortDay(r.date)} · ${clockOf(r.time).full}`;
}

/** The banner's words (values 19.4): the relative line, else "Completed" / "Cancelled" / "Booked for 7:00 PM" (another
 *  day, or a past one, B11). `tone` null = the plain --text-2. */
export function bannerOf(r: Reservation, nowMs: number, today: string): { time: string; text: string; tone: ResTone | null } {
  const time = clockOf(r.time).full;
  const rel = relativeOf(r, nowMs, today);
  if (rel.text) return { time, text: rel.text, tone: rel.tone };
  if (r.status === "Completed" || r.status === "Cancelled") return { time, text: r.status, tone: null };
  return { time, text: `Booked for ${time}`, tone: null };
}

export interface DetailStep {
  label: "Booked" | "Seated" | "Completed";
  /** The dot, and the label's ink, are the reached colours. */
  reached: boolean;
  /** The line after this step is the reached colour (the step before the current one). */
  lineDone: boolean;
  /** "2 Nov" under Booked (the day the booking was made); "" otherwise. */
  time: string;
}

/** "2 Nov" from an ISO instant, as the cafe's IST day. */
export function madeOn(iso: string): string {
  const day = shortDay(cafeDateString(new Date(iso)));
  return day.slice(day.indexOf(", ") + 2);
}

/** The three steps (values 10.3, 19.4): dots up to the status's index, lines before it; a Cancelled booking is grey all
 *  through. No Seated time (we keep none, B19). */
export function stepsOf(r: Reservation): DetailStep[] {
  const index = { Booked: 0, Seated: 1, Completed: 2, Cancelled: -1 }[r.status];
  const labels = ["Booked", "Seated", "Completed"] as const;
  return labels.map((label, i) => ({
    label,
    reached: i <= index,
    lineDone: i < index,
    time: i === 0 ? madeOn(r.createdAt) : "",
  }));
}

export type FactTone = "plain" | "warn" | "faint";

/** The Table fact (values 10.4, B19): "T-3 · 4 seats" (warn when the seats are fewer than the guests), "T-3" while the
 *  tables load, "T-9 · no longer on the floor plan" (warn), "Not assigned yet" (faint). */
export function tableFact(r: Reservation, tables: readonly Table[] | undefined): { text: string; tone: FactTone } {
  if (!r.tableNo) return { text: "Not assigned yet", tone: "faint" };
  if (tables === undefined) return { text: r.tableNo, tone: "plain" };
  const table = tables.find((t) => t.tableNo === r.tableNo);
  if (!table) return { text: `${r.tableNo} · no longer on the floor plan`, tone: "warn" };
  if (!(table.capacity > 0)) return { text: r.tableNo, tone: "plain" };
  return {
    text: `${r.tableNo} · ${table.capacity} seat${table.capacity === 1 ? "" : "s"}`,
    tone: table.capacity < r.guests ? "warn" : "plain",
  };
}

/** The Guest history fact: "3 past visits", "1 past visit", "First booking". */
export function historyFact(pastVisits: number): string {
  return pastVisits > 0 ? `${pastVisits} past visit${pastVisits === 1 ? "" : "s"}` : "First booking";
}
