// U6 Task 2 (2026-11-03): renders of the list's rows (values 8.2 - 8.4; design 6.3): which primary and which icons each
// status shows, the struck time of a Cancelled booking, the open button's name, the day tag on All dates / a search, and
// that the busy flag disables only the writes (B13). Fixed clocks (the IST instant written out).
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Reservation } from "@/types";
import { classesOf, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { ReservationRowCard } from "@/components/reservations/ReservationRowCard";
import { ReservationsTable } from "@/components/reservations/ReservationsTable";
import { ReservationPill } from "@/components/reservations/ReservationPill";

(globalThis as { React?: typeof React }).React = React;

const TODAY = "2026-10-19";
const NOW = Date.parse("2026-10-19T17:00:00+05:30");
let seq = 0;
function res(over: Partial<Reservation> = {}): Reservation {
  seq += 1;
  return { _id: `r${seq}`, name: "Asha Rao", mobile: "9867004512", date: TODAY, time: "19:00", guests: 4, tableNo: "T-3", status: "Booked", createdAt: "", updatedAt: "", ...over };
}
const noop = () => {};
function card(r: Reservation, o: { showDay?: boolean; selected?: boolean; busy?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ReservationRowCard, { r, first: true, nowMs: NOW, today: TODAY, showDay: o.showDay ?? false, selected: o.selected ?? false, busy: o.busy ?? false, onOpen: noop, onAction: noop }),
  );
}
function table(rows: Reservation[], o: { showDay?: boolean; selectedId?: string | null; busy?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ReservationsTable, { rows, nowMs: NOW, today: TODAY, showDay: o.showDay ?? false, selectedId: o.selectedId ?? null, busy: o.busy ?? false, onOpen: noop, onAction: noop }),
  );
}
const titles = (html: string): string[] => [...html.matchAll(/<button[^>]*title="([^"]+)"/g)].map((m) => m[1]);

test("a Booked-today card shows Seat; a Booked-tomorrow card shows none; both show the pill", () => {
  const today = card(res());
  assert.equal(textOf(today, "reservations-card-primary"), "Seat", "Seat on today's booking");
  assert.equal(textOf(today, "reservations-card-pill"), "Booked", "the pill");
  const tomorrow = card(res({ date: "2026-10-20" }));
  assert.equal(tagOf(tomorrow, "reservations-card-primary"), "", "no primary on another day (values 8.4)");
  assert.equal(textOf(tomorrow, "reservations-card-sub"), "4 guests · T-3", "the sub");
});

test("the card: time column '7:00' + 'PM', the sub, the relative line, the open button's name", () => {
  const html = card(res());
  assert.equal(textOf(html, "reservations-card-time"), "7:00", "Geist Mono time");
  assert.equal(textOf(html, "reservations-card-ap"), "PM", "AM / PM");
  assert.equal(textOf(html, "reservations-card-relative"), "in 2h 00m", "the relative line");
  assert.match(tagOf(html, "reservations-card-open"), /aria-label="Asha Rao, 7:00 PM, Booked"/, "B7: the open button's name");
  assert.deepEqual(titles(html), [], "a card has no icon buttons (values 8.3)");
});

test("one guest and no table: '1 guest · No table'", () => {
  assert.equal(textOf(card(res({ guests: 1, tableNo: undefined })), "reservations-card-sub"), "1 guest · No table", "plural and the table word");
});

test("showDay (All dates / a search) puts the day tag in front of the card sub and the table's sub-line", () => {
  const r = res({ date: "2026-11-04" });
  assert.equal(textOf(card(r, { showDay: true }), "reservations-card-sub"), "Wed 4 · 4 guests · T-3", "the card sub");
  assert.equal(textOf(table([r], { showDay: true }), "reservations-row-sub"), "Wed 4 · +91 98670 04512", "the table sub-line starts with the day");
  assert.equal(textOf(table([r], { showDay: false }), "reservations-row-sub"), "+91 98670 04512", "no tag on a single day");
});

test("a Seated row: Open order (a /pos link) and the icons Mark completed + Cancel booking", () => {
  const html = table([res({ status: "Seated" })]);
  assert.deepEqual(titles(html), ["Mark completed · guests left", "Cancel booking"], "two icons, in order");
  assert.match(tagOf(html, "reservations-row-primary"), /^<a /, "Open order is a link");
  assert.match(tagOf(html, "reservations-row-primary"), /href="\/pos"/, "to /pos");
  assert.equal(textOf(html, "reservations-row-primary"), "Open order", "its word");
  assert.equal(textOf(html, "reservations-row-pill"), "Seated", "the pill");
});

test("a Seated booking with no table has no primary (B26) but keeps its icons", () => {
  const html = table([res({ status: "Seated", tableNo: undefined })]);
  assert.equal(tagOf(html, "reservations-row-primary"), "", "no Open order without a table");
  assert.equal(titles(html).length, 2, "the two icons stay");
});

test("a Completed row: Book again, no icon, no relative line", () => {
  const html = table([res({ status: "Completed" })]);
  assert.equal(textOf(html, "reservations-row-primary"), "Book again", "the primary");
  assert.deepEqual(titles(html), [], "no icon");
  assert.equal(tagOf(html, "reservations-row-relative"), "", "no relative line");
});

test("a Cancelled row: Restore booking + Book again, the time struck through, the name not", () => {
  const html = table([res({ status: "Cancelled" })]);
  assert.deepEqual(titles(html), ["Restore booking"], "the restore icon");
  assert.equal(textOf(html, "reservations-row-primary"), "Book again", "Book again");
  assert.ok(classesOf(tagOf(html, "reservations-row-time")).includes("line-through"), "the time is struck");
  assert.ok(!classesOf(tagOf(html, "reservations-row-open")).includes("line-through"), "the name is not");
  const c = card(res({ status: "Cancelled" }));
  assert.ok(classesOf(tagOf(c, "reservations-card-time")).includes("line-through"), "the card's time is struck too");
});

test("Assign: a Booked or Seated booking with no table, never a Completed one (B26)", () => {
  assert.equal(textOf(table([res({ tableNo: undefined })]), "reservations-row-assign"), "Assign", "Booked without a table");
  assert.equal(textOf(table([res({ status: "Seated", tableNo: undefined })]), "reservations-row-assign"), "Assign", "Seated without a table");
  assert.equal(tagOf(table([res({ status: "Completed", tableNo: undefined })]), "reservations-row-assign"), "", "Completed: none");
  assert.equal(tagOf(table([res()]), "reservations-row-assign"), "", "a table is set: none");
  assert.equal(textOf(table([res()]), "reservations-row-table"), "T-3", "the table's name");
});

test("busy disables Seat, Complete, Cancel and Restore; Open order, Book again and Assign stay live (B13)", () => {
  const disabled = (html: string, title: string): boolean => /disabled=""/.test((html.match(new RegExp(`<button[^>]*title="${title}"[^>]*>`)) ?? [""])[0]);
  const seated = table([res({ status: "Seated" })], { busy: true });
  assert.ok(disabled(seated, "Mark completed · guests left"), "Complete");
  assert.ok(disabled(seated, "Cancel booking"), "Cancel");
  assert.ok(!/disabled=""/.test(tagOf(seated, "reservations-row-primary")), "Open order stays a live link");
  assert.ok(/disabled=""/.test(tagOf(table([res()], { busy: true }), "reservations-row-primary")), "Seat");
  assert.ok(disabled(table([res({ status: "Cancelled" })], { busy: true }), "Restore booking"), "Restore");
  assert.ok(!/disabled=""/.test(tagOf(table([res({ status: "Cancelled" })], { busy: true }), "reservations-row-primary")), "Book again");
  assert.ok(!/disabled=""/.test(tagOf(table([res({ tableNo: undefined })], { busy: true }), "reservations-row-assign")), "Assign");
});

test("a selected row takes the tint; Open order on it takes bg-card (B16)", () => {
  const r = res({ status: "Seated" });
  const html = table([r], { selectedId: r._id });
  assert.ok(classesOf(tagOf(html, "reservations-row")).includes("bg-status-info-tint"), "the tint");
  assert.ok(classesOf(tagOf(html, "reservations-row-primary")).includes("bg-card"), "Open order on the tint");
  assert.ok(classesOf(tagOf(card(r, { selected: true }), "reservations-card")).includes("bg-status-info-tint"), "the card's tint");
  assert.ok(!classesOf(tagOf(table([r]), "reservations-row")).includes("bg-status-info-tint"), "none when not selected");
  assert.match(tagOf(html, "reservations-row-open"), /aria-current="true"/, "the selected row says so");
});

test("a Late booking says Late in the pill and the relative line", () => {
  const late = res({ time: "16:00" });
  const html = card(late);
  assert.equal(textOf(html, "reservations-card-pill"), "Late", "the pill");
  assert.equal(textOf(html, "reservations-card-relative"), "Late · 1h 00m", "the line");
  assert.match(tagOf(html, "reservations-card-open"), /aria-label="Asha Rao, 4:00 PM, Late"/, "the name carries it");
});

test("dimmed rows carry the token colours; a long name wraps (anywhere), the table sub-line truncates", () => {
  const html = table([res({ status: "Completed", name: "x".repeat(120), notes: "n".repeat(205) })]);
  const nameCls = classesOf(tagOf(html, "reservations-row-open"));
  assert.ok(nameCls.includes("text-muted-foreground") && nameCls.includes("[overflow-wrap:anywhere]"), "name: --text-2, wraps");
  assert.ok(classesOf(tagOf(html, "reservations-row-sub")).includes("truncate"), "the sub-line is one line");
  assert.equal(tagsOf(html, "reservations-row").length, 1, "one row");
});

test("the pill: the dot and the words, each size", () => {
  for (const size of ["card", "table", "detail"] as const) {
    const html = renderToStaticMarkup(createElement(ReservationPill, { kind: "Late", size }));
    assert.match(html, /Late/, `${size}: the word`);
    assert.ok(classesOf(tagOf(html, "reservations-pill")).includes("bg-status-warn-tint"), `${size}: the Late tint`);
    assert.ok(classesOf(tagOf(html, "reservations-pill-dot")).includes("bg-status-warn"), `${size}: the dot`);
  }
});

test("Completed and Cancelled pills take the neutral surface-3 look", () => {
  for (const kind of ["Completed", "Cancelled"] as const) {
    const html = renderToStaticMarkup(createElement(ReservationPill, { kind, size: "card" }));
    assert.ok(classesOf(tagOf(html, "reservations-pill")).includes("bg-surface-3"), `${kind}: surface-3`);
    assert.ok(!classesOf(tagOf(html, "reservations-pill")).includes("bg-muted"), `${kind}: not the muted tint`);
  }
});
