// Tables redesign Step 0 — the table-status vocabulary (lib/table-status):
// meta completeness, class strings built from the pinned hex values, WCAG
// contrast (luminance math copied from lib/brand-contrast.test.ts), the
// long-stay threshold fallback and the free-table rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TABLE_LONG_STAY_DEFAULT_MINUTES, TABLE_STATUSES } from "@/lib/constants";
import { TABLE_STATUS_META, isFreeTable, longStayMinutesOf } from "@/lib/table-status";

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;
const WHITE = "#ffffff";

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("contrast helper sanity: black on white is 21, identical colours are 1", () => {
  assert.ok(Math.abs(contrast("#000000", WHITE) - 21) < 0.01);
  assert.equal(contrast("#123456", "#123456"), 1);
});

test("TABLE_STATUS_META has an entry for every TABLE_STATUSES value, with label === status", () => {
  assert.ok(TABLE_STATUSES.length >= 3, "landmark: the status list itself is populated");
  for (const status of TABLE_STATUSES) {
    const meta = TABLE_STATUS_META[status];
    assert.ok(meta, `no meta for ${status}`);
    assert.equal(meta.label, status);
  }
  assert.deepEqual(Object.keys(TABLE_STATUS_META).sort(), [...TABLE_STATUSES].sort(), "no extra/stale meta keys");
});

test("class strings are built from the pinned hex values", () => {
  for (const status of TABLE_STATUSES) {
    const m = TABLE_STATUS_META[status];
    assert.match(m.fg, /^#[0-9a-f]{6}$/i);
    assert.match(m.bg, /^#[0-9a-f]{6}$/i);
    assert.match(m.mark, /^#[0-9a-f]{6}$/i);
    assert.ok(m.chipClass.includes(`bg-[${m.bg}]`), `${status} chipClass lacks bg-[${m.bg}]: ${m.chipClass}`);
    assert.ok(m.chipClass.includes(`text-[${m.fg}]`), `${status} chipClass lacks text-[${m.fg}]: ${m.chipClass}`);
    assert.ok(m.dotClass.includes(m.mark), `${status} dotClass lacks mark ${m.mark}`);
    // Floor redesign (2026-10-02): the tile is tinted with the chip colours instead of a stripe.
    assert.ok(m.tileClass.includes(`bg-[${m.bg}]`), `${status} tileClass lacks bg-[${m.bg}]: ${m.tileClass}`);
    assert.ok(m.tileClass.includes(m.borderClass), `${status} tileClass lacks its border ${m.borderClass}`);
    assert.equal(m.textClass, `text-[${m.fg}]`, `${status} textClass must be its fg colour`);
    assert.ok(m.borderClass.length > 0);
  }
});

test("the three statuses are told apart: every colour role is distinct across statuses", () => {
  for (const role of ["fg", "bg", "mark"] as const) {
    const values = TABLE_STATUSES.map((s) => TABLE_STATUS_META[s][role]);
    assert.equal(new Set(values).size, values.length, `${role} repeats across statuses`);
  }
});

test("contrast: fg on bg is at least 4.5:1 and the mark against white at least 3:1", () => {
  for (const status of TABLE_STATUSES) {
    const m = TABLE_STATUS_META[status];
    assert.ok(contrast(m.fg, m.bg) >= TEXT_MIN, `${status} chip text ${m.fg} on ${m.bg} = ${contrast(m.fg, m.bg).toFixed(2)}`);
    assert.ok(contrast(m.mark, WHITE) >= NON_TEXT_MIN, `${status} mark ${m.mark} on white = ${contrast(m.mark, WHITE).toFixed(2)}`);
  }
});

// The live floor tile prints the brand ink (table, bill, action), the brand muted text (seats, items, stay time) and,
// on an Occupied tile only, the brand danger colour ("Free table") straight onto the status tint.
test("contrast: every text colour the floor tile prints stays readable on its status tint", () => {
  const css = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");
  const token = (name: string): string => {
    const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"))?.[1];
    assert.ok(value, `--${name} must be a 6-digit hex in app/globals.css`);
    return value;
  };
  const ink = token("brand-ink");
  const muted = token("brand-muted");
  const danger = token("brand-danger");
  for (const status of TABLE_STATUSES) {
    const { bg } = TABLE_STATUS_META[status];
    assert.ok(contrast(ink, bg) >= TEXT_MIN, `${status}: ink ${ink} on ${bg} = ${contrast(ink, bg).toFixed(2)}`);
    assert.ok(contrast(muted, bg) >= TEXT_MIN, `${status}: muted ${muted} on ${bg} = ${contrast(muted, bg).toFixed(2)}`);
  }
  const occupied = TABLE_STATUS_META.Occupied.bg;
  assert.ok(contrast(danger, occupied) >= TEXT_MIN, `danger ${danger} on ${occupied} = ${contrast(danger, occupied).toFixed(2)}`);
});

test("longStayMinutesOf: missing settings / absent key / out-of-range / non-integer fall back to the default", () => {
  assert.equal(TABLE_LONG_STAY_DEFAULT_MINUTES, 60, "landmark: default is 60");
  assert.equal(longStayMinutesOf(undefined), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({}), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 14 }), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 601 }), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 45.5 }), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: Number.NaN }), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 0 }), TABLE_LONG_STAY_DEFAULT_MINUTES);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: -30 }), TABLE_LONG_STAY_DEFAULT_MINUTES);
});

test("longStayMinutesOf: in-range integers are kept, bounds inclusive", () => {
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 45 }), 45);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 15 }), 15);
  assert.equal(longStayMinutesOf({ tableLongStayMinutes: 600 }), 600);
});

test("isFreeTable: only an Available table with no order pointer is free", () => {
  assert.equal(isFreeTable({ status: "Available" }), true);
  assert.equal(isFreeTable({ status: "Available", currentOrderId: undefined }), true);
  assert.equal(isFreeTable({ status: "Available", currentOrderId: "ord-1" }), false);
  assert.equal(isFreeTable({ status: "Reserved" }), false);
  assert.equal(isFreeTable({ status: "Occupied" }), false);
  assert.equal(isFreeTable({ status: "Occupied", currentOrderId: "ord-1" }), false);
});
