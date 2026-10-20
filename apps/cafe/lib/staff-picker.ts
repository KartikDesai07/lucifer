import { pinFailureMessage, type PinSignInFailure } from "@pos/shared/staff-pin";

import { pickerGreeting } from "@/lib/brand-time";
import type { KnownPerson } from "@/lib/pin-sign-in-client";

// The staff picker's and PIN pad's pure rules (components/auth/PinSignIn, the owner's HTML lock: values 4.3–4.4,
// design 5.6): the tabs and their counts, the filter, each tile's line, the pad's words, the date and greeting lines,
// and when Escape goes back. No React, no clock of its own: callers pass the time, so each rule is tested at fixed
// values (lib/login-pin-paths.test.ts).

export type StaffFilter = "all" | "admin" | "staff";

/** Our two roles' words (the tab labels, a tile's line, the pad's "{Role} · Enter your 4-digit PIN"). */
export const ROLE_LABEL: Record<KnownPerson["role"], string> = { admin: "Admin", staff: "Staff" };

const FILTER_TABS: { value: StaffFilter; label: string }[] = [
  { value: "all", label: "All staff" },
  { value: "admin", label: "Admin" },
  { value: "staff", label: "Staff" },
];

// Fixed English tables, not toLocaleString, so a device set to another language never changes the line.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "Friday, 16 October": the picker's date, in the counter's own local time. */
export function pickerDateLabel(now: Date): string {
  return `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

/** "Good evening": the picker's headline, by the HTML's hours (ruling R28). */
export function pinGreeting(now: Date): string {
  return pickerGreeting(now);
}

/** The tiles for a role tab and a search (trimmed, any case, the full name or the short one). */
export function visiblePeople(people: KnownPerson[], filter: StaffFilter, query: string): KnownPerson[] {
  const q = query.trim().toLowerCase();
  return people.filter(
    (p) =>
      (filter === "all" || p.role === filter) &&
      (q === "" || p.name.toLowerCase().includes(q) || p.shortName.toLowerCase().includes(q)),
  );
}

/** The role tabs with their counts: everyone this device remembers, the admins, the staff (design 5.6, our roles). */
export function roleTabs(people: KnownPerson[]): { value: StaffFilter; label: string; count: number }[] {
  return FILTER_TABS.map((tab) => ({
    ...tab,
    count: tab.value === "all" ? people.length : people.filter((p) => p.role === tab.value).length,
  }));
}

export type TileSub = { text: string; tone: "locked" | "blocked" | "out" | "role" };

/**
 * The line under a tile's name (values 4.3 tile states, design 5.6): the locker's "Locked · {ago}"; "PIN blocked" for
 * a PIN this screen has been told is blocked; "Try again soon" while our local wait runs for that person (ruling R37,
 * the HTML's locked-out words); else the role.
 */
export function tileSub(
  person: KnownPerson,
  highlight: { id: string; label: string } | null,
  blocked: ReadonlySet<string>,
  waitingId: string | null,
): TileSub {
  if (highlight?.id === person.id) return { text: highlight.label, tone: "locked" };
  if (blocked.has(person.id)) return { text: "PIN blocked", tone: "blocked" };
  if (waitingId === person.id) return { text: "Try again soon", tone: "out" };
  return { text: ROLE_LABEL[person.role], tone: "role" };
}

/** An empty search's line (the HTML's words, values 4.3). */
export function noStaffLine(query: string): string {
  return `No staff found for “${query.trim()}”.`;
}

/**
 * What the pad shows: a wait (seconds left on the local countdown) disables it and words the minutes left; a block
 * disables it; a try in flight disables it; any other refusal (a wrong PIN included) leaves it enabled to try again.
 */
export function pinPadView(input: {
  failure: PinSignInFailure | null;
  waitLeftSec: number;
  busy: boolean;
}): { message: string | null; disabled: boolean } {
  if (input.waitLeftSec > 0) {
    return { message: pinFailureMessage({ kind: "wait", retryAfterSec: input.waitLeftSec }), disabled: true };
  }
  return {
    message: input.failure ? pinFailureMessage(input.failure) : null,
    disabled: input.busy || input.failure?.kind === "blocked",
  };
}

/** Ruling R34 (values 4.4): Escape on the pad goes back to the picker — never from a field, never while a try is in
 *  flight (its answer belongs to this pad, as the disabled "All staff" link says). */
export function escapeGoesBack(input: { key: string; activeTag: string | undefined; busy: boolean }): boolean {
  if (input.key !== "Escape" || input.busy) return false;
  return input.activeTag !== "INPUT" && input.activeTag !== "TEXTAREA";
}
