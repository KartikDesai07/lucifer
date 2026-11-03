// The seat / assign dialog's rules (U6 Task 3, 2026-11-03; values 14, 19.5; design 8.2, B18), pure: which booking holds a
// table near a time, and what a table's tile says. Our tables carry no open-bill amount here (no bills are loaded), so
// "Occupied" is the table's own status; areas stay off this screen (P22).
import { bookingAt, clockOf } from "@/lib/reservations-view";
import type { Reservation, Table } from "@/types";

/** How long a booking holds its table either side of its time (the HTML's RHOLD, values 19.5). */
export const HOLD_MINUTES = 90;

/** Another booking on the same table and date, Booked or Seated, less than HOLD_MINUTES apart (either side); the booking
 *  itself (`bookingId`, null for a new one) never counts. */
export function conflictFor(
  list: readonly Reservation[],
  bookingId: string | null,
  tableNo: string,
  date: string,
  time: string,
): Reservation | null {
  const at = bookingAt({ date, time });
  return (
    list.find(
      (r) =>
        r._id !== bookingId &&
        r.tableNo === tableNo &&
        r.date === date &&
        (r.status === "Booked" || r.status === "Seated") &&
        Math.abs(bookingAt(r) - at) < HOLD_MINUTES * 60_000,
    ) ?? null
  );
}

export interface SeatTile {
  /** The line under the table's name; "" says nothing (a table with no capacity set). */
  sub: string;
  /** The dot and the line's colour. */
  tone: "ok" | "warn" | "info" | "reserved";
  /** Not pickable (an Occupied table while seating). */
  off: boolean;
  /** Free, no conflict and big enough: the tile's border is the ok colour. */
  fits: boolean;
}

const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

/** A table's tile for the booking (values 14 `rspVals`, B18). Precedence: Occupied (only for a booking of today: it is the
 *  table's state now; off when seating, pickable when assigning); Reserved (held on the Floor: pickable in both modes); a
 *  conflicting booking ("Seated · Neha" / "Booked 8:15 PM"); the capacity ("4 seats", "Seats 2 only"). A conflicting or
 *  too small table can still be picked. */
export function seatTile(
  table: Table,
  booking: { id: string; date: string; time: string; guests: number },
  list: readonly Reservation[],
  mode: "seat" | "assign",
  today: string,
): SeatTile {
  const isToday = booking.date === today;
  if (isToday && table.status === "Occupied") return { sub: "Occupied", tone: "info", off: mode === "seat", fits: false };
  if (isToday && table.status === "Reserved") return { sub: "Reserved", tone: "reserved", off: false, fits: false };
  const other = conflictFor(list, booking.id, table.tableNo, booking.date, booking.time);
  if (other) {
    const sub = other.status === "Seated" ? `Seated · ${firstName(other.name)}` : `Booked ${clockOf(other.time).full}`;
    return { sub, tone: "warn", off: false, fits: false };
  }
  if (!(table.capacity > 0)) return { sub: "", tone: "ok", off: false, fits: true };
  if (table.capacity >= booking.guests) {
    return { sub: `${table.capacity} seat${table.capacity === 1 ? "" : "s"}`, tone: "ok", off: false, fits: true };
  }
  return { sub: `Seats ${table.capacity} only`, tone: "warn", off: false, fits: false };
}
