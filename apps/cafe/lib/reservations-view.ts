// The Reservations page's view model (U6 Task 1, 2026-11-03): pure and client-safe (no React), so the page, the rows, the
// detail and the seat dialog read one set of rules and the tests pin them with fixed clocks. It is the owner's HTML
// view-model (docs/superpowers/specs/2026-11-02-reservations-html-values.md 19.1 days, counts and the list, 19.2 the
// relative time, 19.3 the pill and the actions, 9 the empty words) on our four statuses (Booked / Seated / Completed /
// Cancelled), with the design's rulings (docs/superpowers/specs/2026-11-03-reservations-match-html-design.md 6, 7, 13):
// B11 (Late and the relative line are only for today's bookings), B12 (the day is held as "unset" and follows the clock),
// B26 (a Seated booking with no table has no primary). Every date is an IST "YYYY-MM-DD" string, every instant the IST
// booking time (the cafe's clock, as cafeDateString).
import type { Reservation } from "@/types";

export type ResTab = "upcoming" | "seated" | "done" | "cancelled" | "all";
/** The chosen day: null = today, following the clock (B12); "all" = every date (owner Q7); else "YYYY-MM-DD". */
export type ResDayChoice = null | "all" | string;
export type ResPill = "Booked" | "Late" | "Seated" | "Completed" | "Cancelled";
export type ResTone = "bad" | "warn" | "accent" | "muted" | "ok";
export type ResAction = "seat" | "openOrder" | "bookAgain" | "cancel" | "complete" | "restore" | "assign";

const MINUTE_MS = 60_000;
/** A Booked booking is Late once its time is more than this far behind (values 19.1: now > time + 15 min). */
const LATE_AFTER_MIN = 15;
/** Within this many minutes the relative line counts down in the accent ("in 45 min"). */
const SOON_MIN = 60;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// ── Times and words ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The IST instant of a booking. */
export function bookingAt(r: Pick<Reservation, "date" | "time">): number {
  return Date.parse(`${r.date}T${r.time}:00+05:30`);
}

/** "19:00" → "7:00 PM"; "00:30" → "12:30 AM" (the shared formatTime keeps its "0:30 AM" for its other users). */
export function clockOf(time: string): { full: string; hm: string; ap: "AM" | "PM" } {
  const [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  const hm = `${hour}:${String(m).padStart(2, "0")}`;
  return { full: `${hm} ${ap}`, hm, ap };
}

/** Ten digits → "+91 98670 04512"; anything else as stored. */
export function formatMobile(m: string): string {
  return /^\d{10}$/.test(m) ? `+91 ${m.slice(0, 5)} ${m.slice(5)}` : m;
}

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? "" : "s"}`;

/** values 19.2 dur(): minutes under an hour ("30 min"), else "1h 30m" with two-digit minutes ("2h 05m"). */
function duration(ms: number): string {
  const m = Math.max(1, Math.round(ms / MINUTE_MS));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ── Days ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function dayParts(day: string): { y: number; m: number; d: number; weekday: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** A day moved by n days (calendar arithmetic on the string; no zone). */
export function shiftDay(day: string, n: number): string {
  const { y, m, d } = dayParts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The shown day: an unset choice is today, so a tab left open past midnight shows the new day (B12). Not for "all". */
export function resolveDay(day: ResDayChoice, today: string): string {
  return day ?? today;
}

/** "Tuesday, 3 November". */
export function fullDay(day: string): string {
  const { m, d, weekday } = dayParts(day);
  return `${WEEKDAYS[weekday]}, ${d} ${MONTHS[m - 1]}`;
}

/** "Tue, 3 Nov". */
export function shortDay(day: string): string {
  const { m, d, weekday } = dayParts(day);
  return `${WEEKDAYS[weekday].slice(0, 3)}, ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** "Wed 4": the day's tag in front of a row on All dates and in a search. */
export function dayTag(day: string): string {
  const { d, weekday } = dayParts(day);
  return `${WEEKDAYS[weekday].slice(0, 3)} ${d}`;
}

/** The day box's words (values 3): "Today · Mon, 19 Oct" / "Tomorrow · Tue, 20 Oct" / "Yesterday · Sun, 18 Oct" / "Wed,
 *  21 Oct"; a phone drops the weekday ("Today", "Tomorrow", "18 Oct", "21 Oct"). */
export function dayLabel(day: string | "all", today: string, phone: boolean): string {
  if (day === "all") return "All dates";
  const { m, d } = dayParts(day);
  const short = `${d} ${MONTHS[m - 1].slice(0, 3)}`;
  const word = day === today ? "Today" : day === shiftDay(today, 1) ? "Tomorrow" : day === shiftDay(today, -1) ? "Yesterday" : null;
  if (phone) return word === "Today" || word === "Tomorrow" ? word : short;
  return word ? `${word} · ${shortDay(day)}` : shortDay(day);
}

// ── The relative line and the pill ──────────────────────────────────────────────────────────────────────────────────

/** The booking's minutes ahead of now, rounded as the HTML's (negative = behind). */
function minutesAhead(r: Reservation, nowMs: number): number {
  return Math.round((bookingAt(r) - nowMs) / MINUTE_MS);
}

/** values 19.2 with B11: Seated → "Seated {time}" (we have no seated-at time: the booking's, the HTML's fallback); a
 *  Booked booking of TODAY only → "Late · 25 min" / "Due now" / "in 45 min" / "in 2h 10m"; every other day, Completed
 *  and Cancelled → nothing. */
export function relativeOf(
  r: Reservation,
  nowMs: number,
  today: string,
): { text: string; tone: ResTone | null; weight: 400 | 500 | 600 } {
  if (r.status === "Seated") return { text: `Seated ${clockOf(r.time).full}`, tone: "ok", weight: 500 };
  if (r.status !== "Booked" || r.date !== today) return { text: "", tone: null, weight: 400 };
  const m = minutesAhead(r, nowMs);
  if (m < -LATE_AFTER_MIN) return { text: `Late · ${duration(-m * MINUTE_MS)}`, tone: "bad", weight: 600 };
  if (m <= 0) return { text: "Due now", tone: "warn", weight: 600 };
  if (m <= SOON_MIN) return { text: `in ${m} min`, tone: "accent", weight: 600 };
  return { text: `in ${duration(m * MINUTE_MS)}`, tone: "muted", weight: 400 };
}

/** The pill: our four statuses, and "Late" for a Booked booking of today more than 15 minutes past its time (B11). */
export function pillOf(r: Reservation, nowMs: number, today: string): ResPill {
  if (r.status !== "Booked") return r.status;
  return r.date === today && minutesAhead(r, nowMs) < -LATE_AFTER_MIN ? "Late" : "Booked";
}

// ── Search, the list, the counts ────────────────────────────────────────────────────────────────────────────────────

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const digitsOf = (s: string): string => s.replace(/\D/g, "");
const MIN_SEARCH_DIGITS = 3;

/** values 9.3 / 19.1: the name or the table contains the query; the table also with "-" and spaces ignored ("T5" finds
 *  "T-5", design 6.2); or three or more digits of the query are in the mobile ("98" alone never searches the phone). */
export function matchesQuery(r: Reservation, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (query === "") return true;
  if (`${r.name} ${r.tableNo ?? ""}`.toLowerCase().includes(query)) return true;
  const squeezed = compact(query);
  if (r.tableNo && squeezed !== "" && compact(r.tableNo).includes(squeezed)) return true;
  const digits = digitsOf(query);
  return digits.length >= MIN_SEARCH_DIGITS && digitsOf(r.mobile).includes(digits);
}

const byWhen = (a: Reservation, b: Reservation): number => bookingAt(a) - bookingAt(b);

function tabHas(r: Reservation, tab: ResTab): boolean {
  if (tab === "all") return true;
  if (tab === "upcoming") return r.status === "Booked";
  if (tab === "seated") return r.status === "Seated";
  if (tab === "done") return r.status === "Completed";
  return r.status === "Cancelled";
}

/** The rows the list shows. A typed search lists every date and status, nearest to now first, and ignores the day and the
 *  tab (values 9.3); else the day's bookings (every date on All dates) of the tab, in date and time order. */
export function listRows(
  list: readonly Reservation[],
  opts: { day: ResDayChoice; tab: ResTab; query: string; nowMs: number; today: string },
): Reservation[] {
  const { day, tab, query, nowMs } = opts;
  if (query.trim() !== "") {
    const near = (r: Reservation): number => Math.abs(bookingAt(r) - nowMs);
    return list.filter((r) => matchesQuery(r, query)).sort((a, b) => near(a) - near(b) || byWhen(a, b));
  }
  const shown = day === "all" ? null : resolveDay(day, opts.today);
  return list.filter((r) => (shown === null || r.date === shown) && tabHas(r, tab)).sort(byWhen);
}

/** The select's counts for the shown day (not the search): upcoming = Booked, Late ones included. */
export function tabCounts(list: readonly Reservation[], day: string | "all"): Record<ResTab, number> {
  const counts: Record<ResTab, number> = { upcoming: 0, seated: 0, done: 0, cancelled: 0, all: 0 };
  for (const r of list) {
    if (day !== "all" && r.date !== day) continue;
    counts.all += 1;
    if (r.status === "Booked") counts.upcoming += 1;
    else if (r.status === "Seated") counts.seated += 1;
    else if (r.status === "Completed") counts.done += 1;
    else counts.cancelled += 1;
  }
  return counts;
}

/** The status select's options (values 4). */
export function tabOptions(counts: Record<ResTab, number>): { value: ResTab; label: string }[] {
  return [
    { value: "upcoming", label: `Upcoming (${counts.upcoming})` },
    { value: "seated", label: `Seated (${counts.seated})` },
    { value: "done", label: `Completed (${counts.done})` },
    { value: "cancelled", label: `Cancelled (${counts.cancelled})` },
    { value: "all", label: `All statuses (${counts.all})` },
  ];
}

// ── The header line and the empty box ───────────────────────────────────────────────────────────────────────────────

/** The header's second line (values 2, design 6.1): "4 upcoming bookings · 19 guests · Monday, 19 October" for the shown
 *  day ("all dates" on All dates); while searching "{n} matches across all dates" ("1 match", never the HTML's "1 matches"). */
export function headerLine(
  list: readonly Reservation[],
  opts: { day: ResDayChoice; query: string; nowMs: number; today: string },
): string {
  if (opts.query.trim() !== "") {
    const n = list.filter((r) => matchesQuery(r, opts.query)).length;
    return `${n} ${n === 1 ? "match" : "matches"} across all dates`;
  }
  const shown = opts.day === "all" ? null : resolveDay(opts.day, opts.today);
  const booked = list.filter((r) => r.status === "Booked" && (shown === null || r.date === shown));
  const guests = booked.reduce((sum, r) => sum + r.guests, 0);
  return `${plural(booked.length, "upcoming booking")} · ${plural(guests, "guest")} · ${shown === null ? "all dates" : fullDay(shown)}`;
}

const EMPTY_TEXT = "Bookings made from here, phone calls or WhatsApp show up in this list.";

/** values 9.1: the empty box's words. */
export function emptyWords(opts: { day: ResDayChoice; tab: ResTab; query: string; today: string }): { title: string; text: string } {
  const q = opts.query.trim();
  if (q !== "") return { title: `No bookings match “${q}”`, text: "Try a name, phone number or table like T5." };
  const where = opts.day === "all" ? "all dates" : fullDay(resolveDay(opts.day, opts.today));
  return {
    title: opts.tab === "upcoming" ? `No upcoming bookings · ${where}` : `Nothing in this list for ${where}`,
    text: EMPTY_TEXT,
  };
}

/** The Completed bookings on the same mobile (digits only) other than this one: "{n} past visits". */
export function pastVisits(list: readonly Reservation[], mobile: string, excludeId: string): number {
  const digits = digitsOf(mobile);
  if (digits === "") return 0;
  return list.filter((r) => r.status === "Completed" && r._id !== excludeId && digitsOf(r.mobile) === digits).length;
}

// ── Actions per status (design 6.3 rows and cards, 7 the detail) ────────────────────────────────────────────────────

/** A row's actions: up to two icon buttons (Edit is the row's own press / the detail's button) and the primary. Seat only
 *  on today's bookings (the HTML); Open order needs a table (B26). */
export function rowActions(r: Reservation, today: string): { icons: ResAction[]; primary: ResAction | null } {
  if (r.status === "Booked") return { icons: ["cancel"], primary: r.date === today ? "seat" : null };
  if (r.status === "Seated") return { icons: ["complete", "cancel"], primary: r.tableNo ? "openOrder" : null };
  if (r.status === "Completed") return { icons: [], primary: "bookAgain" };
  return { icons: ["restore"], primary: "bookAgain" };
}

/** The detail's action grid and the footer's primary: Seat stays for every date (our option); a Completed booking has no
 *  grid. */
export function detailActions(r: Reservation): { grid: ResAction[]; primary: ResAction | null } {
  if (r.status === "Booked") return { grid: ["cancel"], primary: "seat" };
  if (r.status === "Seated") return { grid: ["complete", "cancel"], primary: r.tableNo ? "openOrder" : null };
  if (r.status === "Completed") return { grid: [], primary: "bookAgain" };
  return { grid: ["restore"], primary: "bookAgain" };
}
