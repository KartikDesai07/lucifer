// The Reservations toasts (U6 Task 1; design 8.4): the HTML's words without its Undo (we have none). `first` is the name's
// first word; the apostrophe is U+2019. The error toasts stay the factory's words (hooks/use-reservation-writes.ts).
import type { ReservationStatus } from "@/lib/constants";
import { clockOf, shortDay } from "@/lib/reservations-view";
import type { Reservation } from "@/types";

const first = (r: Pick<Reservation, "name">): string => r.name.trim().split(/\s+/)[0] ?? "";
const guests = (n: number): string => `${n} guest${n === 1 ? "" : "s"}`;
const when = (r: Pick<Reservation, "date" | "time">): string => `${shortDay(r.date)}, ${clockOf(r.time).full}`;

/** "Booked · Tue, 3 Nov, 7:00 PM · 2 guests". */
export const bookedToast = (r: Reservation): string => `Booked · ${when(r)} · ${guests(r.guests)}`;
/** "Booking updated · Tue, 3 Nov, 7:00 PM". */
export const updatedToast = (r: Reservation): string => `Booking updated · ${when(r)}`;
/** "Rahul seated at T-3 · 4 guests" (the table picked, else the booking's); "Rahul seated · 4 guests" with none. */
export function seatedToast(r: Reservation, tableNo?: string): string {
  const table = tableNo ?? r.tableNo;
  return table ? `${first(r)} seated at ${table} · ${guests(r.guests)}` : `${first(r)} seated · ${guests(r.guests)}`;
}
/** "T-3 marked completed"; "Rahul’s booking completed" with no table. */
export const completedToast = (r: Reservation): string => (r.tableNo ? `${r.tableNo} marked completed` : `${first(r)}’s booking completed`);
export const cancelledToast = (r: Reservation): string => `${first(r)}’s booking cancelled`;
export const restoredToast = (): string => "Booking restored";
export const assignedToast = (r: Reservation, tableNo: string): string => `${tableNo} assigned to ${first(r)}`;
/** Today's words. */
export const DELETED_TOAST = "Reservation deleted";

/** The success toast of a status write by the status it sets: Seated, Completed, Cancelled, and Booked = Restore. */
export function statusToast(next: ReservationStatus): (saved: Reservation) => string {
  if (next === "Seated") return (saved) => seatedToast(saved);
  if (next === "Completed") return completedToast;
  if (next === "Cancelled") return cancelledToast;
  return restoredToast;
}
