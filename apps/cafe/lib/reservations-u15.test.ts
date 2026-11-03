// U6 verification fix 1b (2026-11-03): U15 / V2-1 (the cards wrapper is keyed on the shown view, so WebView 109's accessibility
// tree keeps every card after a view change) and V1-1 (a busy table chip is dimmed by tokens, not by opacity, so the Reserved
// words keep the reserved ink at full strength). Source pins: the key and the classes are not visible in a static render.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("U15: the cards wrapper is keyed on the view and the page builds the key from day, tab and query", () => {
  const list = read("components/reservations/ReservationsList.tsx");
  assert.match(list, /<div key=\{viewKey\} data-ui="reservations-cards"/, "the cards wrapper carries key={viewKey}");
  assert.match(list, /data-ui="reservations-rows"/, "the list card stays a permanent wrapper");
  const page = read("app/(dashboard)/reservations/page.tsx");
  const m = page.match(/viewKey=\{`([^`]+)`\}/);
  assert.ok(m, "the page passes viewKey");
  for (const part of ["state.day", "state.tab", "state.query"]) assert.ok(m[1].includes(part), `the key carries ${part}`);
});

test("V1-1: a dimmed form table chip uses no opacity, and the sub words keep the reserved ink", () => {
  const field = read("components/reservations/ReservationTableField.tsx");
  assert.doesNotMatch(field, /opacity-70/, "no opacity on the chip (it faded the Reserved words to 3.97:1)");
  assert.match(field, /RES_SEAT_SUB_INK_CLASS\[tile\.tone\]/, "the sub takes the ink token of its tone");
  assert.match(read("lib/reservations-layout.ts"), /reserved: "text-status-reserved-ink"/, "reserved words are the ink token");
  assert.doesNotMatch(read("components/reservations/ReservationSeatDialog.tsx"), /opacity-\[?\.?7/, "no 70% opacity on the seat tiles");
});
