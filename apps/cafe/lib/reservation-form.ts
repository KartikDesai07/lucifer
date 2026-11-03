// The reservation form's rules (U6 Task 4, 2026-11-03; values 13, 19.6; design 8.1, B20, owner Q2 / Q3 / Q6), pure and
// client-safe: the time slots and their load, the opening values, the summary line, which tables the "best fits" show, the
// table message, and the two request bodies. The form (components/reservations/ReservationFormSheet.tsx) draws them.
import { HOLD_MINUTES, conflictFor } from "@/lib/reservations-tables";
import { bookingAt, clockOf, digitsOf, pastVisits, shiftDay, shortDay } from "@/lib/reservations-view";
import type { CreateReservationInput, Reservation, Table, UpdateReservationInput } from "@/types";

/** What the form holds. `tableNo` undefined = Unassigned; `guests` is NaN while the count box is empty. */
export interface FormValues {
  name: string;
  mobile: string;
  date: string;
  time: string;
  guests: number;
  tableNo?: string | undefined;
  notes?: string;
}

const half = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => {
    const m = from * 60 + i * 30;
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  });

/** Lunch 12:00 - 3:30 PM and Dinner 6:00 - 10:30 PM, every half hour (owner Q2). */
export const LUNCH_SLOTS: readonly string[] = half(12, 8);
export const DINNER_SLOTS: readonly string[] = half(18, 10);

const MINUTE_MS = 60_000;
/** A slot is busy by the other bookings under this many minutes away. */
const LOAD_WINDOW_MIN = 45;
/** Today's slot counts as passed once it is this far behind now. */
const PASSED_AFTER_MIN = 10;
/** The best fits show this many tables (the picked one included). */
const BEST_FITS_MAX = 7;
/** A mobile number is its ten digits. */
const MOBILE_DIGITS = 10;

const active = (r: Reservation): boolean => r.status === "Booked" || r.status === "Seated";

/** The other Booked / Seated guests under 45 minutes from the slot (the booking being edited never counts). */
export function slotGuests(list: readonly Reservation[], date: string, time: string, excludeId: string | null): number {
  const at = bookingAt({ date, time });
  let guests = 0;
  for (const r of list) {
    if (r._id === excludeId || r.date !== date || !active(r)) continue;
    if (Math.abs(bookingAt(r) - at) < LOAD_WINDOW_MIN * MINUTE_MS) guests += r.guests;
  }
  return guests;
}

/** 0 quiet, 1 some (guests > 0), 2 busy (>= 8), 3 full (>= 16). */
export function slotLoad(list: readonly Reservation[], date: string, time: string, excludeId: string | null): 0 | 1 | 2 | 3 {
  const guests = slotGuests(list, date, time, excludeId);
  return guests >= 16 ? 3 : guests >= 8 ? 2 : guests > 0 ? 1 : 0;
}

/** Today's slot earlier than now - 10 minutes (struck and disabled). Never another day. */
export function slotPassed(date: string, time: string, today: string, nowMs: number): boolean {
  return date === today && bookingAt({ date, time }) < nowMs - PASSED_AFTER_MIN * MINUTE_MS;
}

/** A new booking's opening values (B20): the shown day if it is today or later, else today; 2 guests; Book again seeds name,
 *  mobile and guests. */
export function formDefaults(opts: { shownDay: string | "all"; today: string; prefill?: { name: string; mobile: string; guests: number } }): FormValues {
  const { shownDay, today, prefill } = opts;
  const date = shownDay !== "all" && shownDay >= today ? shownDay : today;
  return { name: prefill?.name ?? "", mobile: prefill?.mobile ?? "", date, time: "", guests: prefill?.guests ?? 2, tableNo: undefined, notes: "" };
}

/** The footer's line: "Tue, 3 Nov · 7:00 PM · 2 guests · T-3" / "time not set" / "no table". */
export function summaryLine(v: FormValues): string {
  const day = v.date ? shortDay(v.date) : "date not set";
  const time = v.time ? clockOf(v.time).full : "time not set";
  const guests = Number.isFinite(v.guests) && v.guests >= 1 ? `${v.guests} guest${v.guests === 1 ? "" : "s"}` : "guests not set";
  return `${day} · ${time} · ${guests} · ${v.tableNo || "no table"}`;
}

/** Today's booking whose time is under 90 minutes from now (or with no time yet: now) meets an Occupied table's state. */
const nearNow = (v: FormValues, today: string, nowMs: number): boolean =>
  v.date === today && (v.time === "" || Math.abs(bookingAt(v) - nowMs) < HOLD_MINUTES * MINUTE_MS);

const byName = (a: Table, b: Table): number => a.tableNo.localeCompare(b.tableNo, undefined, { numeric: true });

/** The tables the "best fits" chips show (values 19.6): no conflicting booking, not Occupied while the time is near now, big
 *  enough; ranked by spare seats then name; unknown capacity after the known fits; the first 7, the picked table kept (it
 *  is prepended when it would fall outside). */
export function bestFits(
  tables: readonly Table[],
  v: FormValues,
  list: readonly Reservation[],
  editingId: string | null,
  today: string,
  nowMs: number,
): Table[] {
  const near = nearNow(v, today, nowMs);
  const free = tables.filter((t) => {
    if (near && t.status === "Occupied") return false;
    return !(v.time !== "" && conflictFor(list, editingId, t.tableNo, v.date, v.time));
  });
  // An empty count (NaN) counts as one guest, as the seat tile does.
  const party = Number.isFinite(v.guests) ? v.guests : 1;
  const known = free.filter((t) => t.capacity > 0 && t.capacity >= party).sort((a, b) => a.capacity - b.capacity || byName(a, b));
  const unknown = free.filter((t) => !(t.capacity > 0)).sort(byName);
  const ranked = [...known, ...unknown];
  const picked = v.tableNo ? tables.find((t) => t.tableNo === v.tableNo) : undefined;
  if (!picked) return ranked.slice(0, BEST_FITS_MAX);
  const first = ranked.slice(0, BEST_FITS_MAX);
  return first.includes(picked) ? first : [picked, ...ranked.slice(0, BEST_FITS_MAX - 1)];
}

export interface TableMessage {
  tone: "bad" | "warn";
  text: string;
}

/** The box under the table chips (values 19.6, owner Q3: a warning, Save stays allowed): a booking holding the table (bad), the
 *  table occupied now, a table too small (warn). Nothing for a table that fits or while none is picked. */
export function tableMessage(
  tables: readonly Table[],
  v: FormValues,
  list: readonly Reservation[],
  editingId: string | null,
  today: string,
  nowMs: number,
): TableMessage | null {
  const no = v.tableNo;
  if (!no) return null;
  const other = v.time === "" ? null : conflictFor(list, editingId, no, v.date, v.time);
  if (other) {
    const at = clockOf(other.time).full;
    const text =
      other.status === "Seated"
        ? `${no} has ${other.name} seated from ${at}. Pick another table or leave it unassigned.`
        : `${no} is already booked at ${at} for ${other.name}. Pick another table or leave it unassigned.`;
    return { tone: "bad", text };
  }
  const table = tables.find((t) => t.tableNo === no);
  if (!table) return null;
  if (v.time !== "" && table.status === "Occupied" && nearNow(v, today, nowMs)) {
    return { tone: "warn", text: `${no} is occupied right now. It may not be free by ${clockOf(v.time).full}.` };
  }
  if (table.capacity > 0 && table.capacity < v.guests) {
    return { tone: "warn", text: `${no} seats ${table.capacity}. For ${v.guests} guests you may need to join a table.` };
  }
  return null;
}

/** Today's create body: the typed values, `status: "Booked"`, no tableNo when none (never null). */
export function createPayload(v: FormValues): CreateReservationInput {
  const { tableNo, ...rest } = v;
  return { ...rest, ...(tableNo ? { tableNo } : {}), status: "Booked" };
}

/** Today's edit body (no status) plus Q6: "Unassigned" over a saved table sends `tableNo: null` (the server clears it). */
export function editPayload(v: FormValues, original: Pick<Reservation, "tableNo">): UpdateReservationInput {
  const { tableNo, ...rest } = v;
  if (tableNo) return { ...rest, tableNo };
  return original.tableNo ? { ...rest, tableNo: null } : rest;
}

/** "Returning guest · 3 past visits": only at exactly ten digits, only when the number has Completed visits (we create no
 *  customer profile, so nothing is said of a new number). */
export function returningGuestLine(list: readonly Reservation[], mobile: string, excludeId: string): string | null {
  if (digitsOf(mobile).length !== MOBILE_DIGITS) return null;
  const n = pastVisits(list, mobile, excludeId);
  return n > 0 ? `Returning guest · ${n} past visit${n === 1 ? "" : "s"}` : null;
}

/** The name of the most recently created earlier booking on these ten digits (fills an empty name), or null. */
export function knownName(list: readonly Reservation[], mobile: string, excludeId: string): string | null {
  const digits = digitsOf(mobile);
  if (digits.length !== MOBILE_DIGITS) return null;
  let best: Reservation | null = null;
  for (const r of list) {
    if (r._id === excludeId || digitsOf(r.mobile) !== digits) continue;
    if (best === null || r.createdAt > best.createdAt) best = r;
  }
  return best?.name ?? null;
}

/** The day strip's seven chips from today: "Today" / "Tmrw" / the weekday, over the day number (values 13.2). */
export function dayChips(today: string): { day: string; top: string; num: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const day = shiftDay(today, i);
    return { day, top: i === 0 ? "Today" : i === 1 ? "Tmrw" : shortDay(day).slice(0, 3), num: String(Number(day.slice(8))) };
  });
}

/** "30 Oct": what the More chip reads once a day beyond the strip is picked. */
export const moreLabel = (day: string): string => shortDay(day).split(", ")[1] ?? "More";

/** A time the chips cover (a Lunch or Dinner slot); anything else is "Other time". */
export const isSlotTime = (time: string): boolean => LUNCH_SLOTS.includes(time) || DINNER_SLOTS.includes(time);
