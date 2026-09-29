// UI batch 1 slice G (2026-09-29) — the shared DatePicker replaces every
// native `<input type="date">`. This suite covers the pure string<->Date
// helpers (date-input.ts) plus a source pin: none of the 7 call-site files
// still uses `type="date"`, and each imports DatePicker from the shared path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { formatDateInput, parseDateInput } from "./date-input";
import { stripComments } from "./source-pin-utils";

// ── parseDateInput / formatDateInput ────────────────────────────────────

test("parseDateInput: round-trips a valid YYYY-MM-DD string through formatDateInput", () => {
  const date = parseDateInput("2026-09-29");
  assert.ok(date, "a valid date string must parse");
  assert.equal(formatDateInput(date as Date), "2026-09-29");
});

test('parseDateInput(""): undefined, not a bogus Date', () => {
  assert.equal(parseDateInput(""), undefined);
});

test("parseDateInput: an invalid string returns undefined", () => {
  for (const raw of ["not-a-date", "2026-13-40", "29/09/2026"]) {
    assert.equal(parseDateInput(raw), undefined, `expected undefined for "${raw}"`);
  }
});

test("parseDateInput: a date near local midnight does not shift day — LOCAL parse, never UTC", () => {
  // The historical bug this guards against: `new Date("2026-01-01")` (bare
  // ISO, no time) is parsed as UTC midnight, which under IST (UTC+5:30)
  // displays as 2026-01-01 05:30 the same day — but `toISOString()` on a
  // LOCAL midnight Date one hour before IST midnight-equivalent boundaries
  // is where the real off-by-one lived across the app (never toISOString of
  // this string). parseDateInput must yield a Date whose LOCAL calendar
  // fields are exactly the input. This runs in the host's own zone only (IST
  // on the counter PCs and this dev box; Windows ignores TZ), so it proves the
  // local-field contract, not behaviour under every zone.
  const date = parseDateInput("2026-01-01") as Date;
  assert.ok(date, "must parse");
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 1);
  assert.equal(formatDateInput(date), "2026-01-01");
});

test("formatDateInput: a local Date built from y/m/d formats back to the same string", () => {
  const date = new Date(2026, 8, 29); // month is 0-indexed: September
  assert.equal(formatDateInput(date), "2026-09-29");
});

// ── source pin: every native type="date" input was replaced ────────────────

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

// Reports redesign Batch 1 (2026-09-29): the old Reports page's own From/To
// DatePicker pair was retired along with its page body — every report now
// picks its range through the shared RangeBar (components/dashboard/RangeBar.tsx,
// the Dashboard's own picker), which wraps DatePicker rather than rendering
// one directly, so it has no call site of its own in this list.
const DATE_PICKER_CALL_SITES = [
  "apps/cafe/app/(dashboard)/orders/page.tsx",
  "apps/cafe/app/(dashboard)/reservations/page.tsx",
  "apps/cafe/components/events/EventFormSheet.tsx",
  "apps/cafe/components/reservations/ReservationFormSheet.tsx",
  "apps/cafe/components/reports/EndOfDayButton.tsx",
];

for (const rel of DATE_PICKER_CALL_SITES) {
  test(`PIN: ${rel} imports DatePicker and no longer uses a native type="date" input`, () => {
    const src = readSrc(rel);
    // Positive landmark first (vision-guard) — proves the file was actually
    // read and still contains real code, so an empty/misread file can't make
    // the negative half of this pin pass trivially.
    assert.match(
      src,
      /from "@\/components\/shared\/DatePicker";/,
      `${rel} must import DatePicker from "@/components/shared/DatePicker"`,
    );
    assert.match(src, /<DatePicker\b/, `${rel} must render <DatePicker`);
    assert.ok(
      !/type="date"/.test(src),
      `${rel} must no longer contain a native type="date" input`,
    );
  });
}

// Review findings (2026-09-29, arbitrated against react-day-picker 9.14.0's
// own source): getInitialMonth opens on `month || defaultMonth || today` and
// never on `selected`, and useSingle hands back undefined when the SELECTED
// day is tapped again (no `required`). So the picker must pass defaultMonth,
// and only a clearable picker may turn that re-tap into "".
test("PIN: DatePicker opens on the chosen date's month, and a re-tap of the chosen day never blanks a non-clearable picker", () => {
  const src = readSrc("apps/cafe/components/shared/DatePicker.tsx");
  assert.match(src, /<Calendar\b[\s\S]*?defaultMonth=\{selected\}[\s\S]*?\/>/, "the calendar opens on the selected month");
  const handler = src.match(/const handleSelect = \(day: Date \| undefined\) => \{([\s\S]*?)\n    \};/);
  assert.ok(handler, "landmark: the select handler");
  assert.match(handler![1], /if \(day\) onChange\(formatDateInput\(day\)\);/);
  assert.match(handler![1], /else if \(clearable\) onChange\(""\);/, "an undefined day empties the value ONLY when clearable");
  assert.equal(handler![1].split("onChange(").length - 1, 2, "no other write path in the handler");
});
