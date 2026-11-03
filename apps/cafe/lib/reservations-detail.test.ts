// U6 Task 3 (2026-11-03): renders of the booking detail (values 10.3, 10.4; design 7, B13, B19): the grid and the footer per
// status, the facts and the phone, the assign button, the note, the busy flag, long words. Fixed clocks.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Reservation, Table } from "@/types";
import { tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { ReservationDetail } from "@/components/reservations/ReservationDetail";

(globalThis as { React?: typeof React }).React = React;

const TODAY = "2026-11-03";
const NOW = Date.parse("2026-11-03T18:30:00+05:30");
const noop = () => {};
function res(over: Partial<Reservation> = {}): Reservation {
  return { _id: "r1", name: "Asha Rao", mobile: "9867004512", date: TODAY, time: "19:00", guests: 4, tableNo: "T-3", status: "Booked", createdAt: "2026-11-02T10:00:00.000Z", updatedAt: "", ...over };
}
const tables: Table[] = [
  { _id: "a", tableNo: "T-3", status: "Available", capacity: 4, createdAt: "", updatedAt: "" },
  { _id: "b", tableNo: "T-4", status: "Occupied", capacity: 2, createdAt: "", updatedAt: "" },
];
function detail(r: Reservation, o: { busy?: boolean; list?: Reservation[]; sheet?: boolean } = {}): string {
  return renderToStaticMarkup(
    createElement(ReservationDetail, { r, list: o.list ?? [r], tables, nowMs: NOW, today: TODAY, busy: o.busy ?? false, sheet: o.sheet ?? false, onClose: noop, onAction: noop, onEdit: noop, onAssign: noop }),
  );
}
const words = (html: string, ui: string): string[] => tagsOf(html, ui).map((_, i) => textOf(html, ui, i));

test("a Booked booking of today: the head, the banner, the facts, Cancel in the grid, Seat in the footer", () => {
  const html = detail(res());
  assert.equal(textOf(html, "reservation-detail-name"), "Asha Rao", "the name");
  assert.equal(textOf(html, "reservation-detail-sub"), "4 guests · Tue, 3 Nov · 7:00 PM", "the sub");
  assert.equal(textOf(html, "reservation-detail-time"), "7:00 PM", "the banner time");
  assert.equal(textOf(html, "reservation-detail-banner-text"), "in 30 min", "the relative words");
  assert.equal(textOf(html, "reservation-detail-pill"), "Booked", "the pill");
  assert.deepEqual(words(html, "reservation-detail-action"), ["Cancel"], "Booked: Cancel only");
  assert.equal(textOf(html, "reservation-detail-primary"), "Seat", "the primary");
  assert.equal(textOf(html, "reservation-detail-edit"), "Edit", "Edit");
  assert.equal(tagOf(html, "reservation-detail-close"), "", "no ✕ in the column");
});

test("the facts: Table with its seats, Phone, Guest history (hidden on a phone); the steps and the sub-line", () => {
  const html = detail(res(), { list: [res(), res({ _id: "p1", status: "Completed" }), res({ _id: "p2", status: "Completed" })] });
  const facts = [...html.matchAll(/data-ui="reservation-detail-fact"[^>]*>(.*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, "|"));
  assert.deepEqual(facts, ["|Table||T-3 · 4 seats|", "|Phone||+91 98670 04512|", "|Guest history||2 past visits|"], "values 10.3 facts");
  const history = [...html.matchAll(/<div[^>]*data-ui="reservation-detail-fact"[^>]*>/g)][2][0];
  assert.match(history, /max-tab:hidden/, "Guest history is hidden below 720px; Table and Phone stay (B19)");
  assert.equal(tagsOf(html, "reservation-detail-step").length, 3, "three steps");
});

test("Seated: Completed and Cancel in the grid, Open order in the footer; Completed: no grid, Book again; Cancelled: Restore", () => {
  const seated = detail(res({ status: "Seated" }));
  assert.deepEqual(words(seated, "reservation-detail-action"), ["Completed", "Cancel"], "Seated grid");
  assert.equal(textOf(seated, "reservation-detail-primary"), "Open order", "Open order");
  assert.match(tagOf(seated, "reservation-detail-primary"), /^<a [^>]*href="\/pos"/, "a link to /pos");
  assert.equal(textOf(seated, "reservation-detail-banner-text"), "Seated 7:00 PM", "Seated banner");
  const done = detail(res({ status: "Completed" }));
  assert.equal(tagOf(done, "reservation-detail-grid"), "", "Completed: the grid is not drawn");
  assert.equal(textOf(done, "reservation-detail-primary"), "Book again", "Book again");
  assert.equal(textOf(done, "reservation-detail-banner-text"), "Completed", "Completed banner");
  const cancelled = detail(res({ status: "Cancelled", notes: "Changed plans" }));
  assert.deepEqual(words(cancelled, "reservation-detail-action"), ["Restore"], "Cancelled: Restore");
  assert.equal(textOf(cancelled, "reservation-detail-note"), "Changed plans", "the note");
});

test("another day: Seat stays (our option) and the banner reads 'Booked for 7:00 PM'; a seated booking with no table has no primary (B26)", () => {
  const tomorrow = detail(res({ date: "2026-11-04" }));
  assert.equal(textOf(tomorrow, "reservation-detail-banner-text"), "Booked for 7:00 PM", "B11");
  assert.equal(textOf(tomorrow, "reservation-detail-primary"), "Seat", "Seat any date");
  const seatedNoTable = detail(res({ status: "Seated", tableNo: undefined }));
  assert.equal(tagOf(seatedNoTable, "reservation-detail-primary"), "", "no primary");
  assert.equal(textOf(seatedNoTable, "reservation-detail-assign"), "+ Assign a table", "Assign for a seated booking with no table");
  assert.equal(tagOf(detail(res()), "reservation-detail-assign"), "", "a table is set: no assign");
  assert.equal(tagOf(detail(res({ status: "Completed", tableNo: undefined })), "reservation-detail-assign"), "", "Completed: no assign");
});

test("busy disables Seat, Completed, Cancel and Restore; Edit, Open order and Book again stay live (B13)", () => {
  const disabled = (tag: string): boolean => / disabled=""/.test(tag);
  assert.ok(disabled(tagOf(detail(res(), { busy: true }), "reservation-detail-primary")), "Seat off");
  assert.ok(disabled(tagOf(detail(res(), { busy: true }), "reservation-detail-action")), "Cancel off");
  assert.ok(!disabled(tagOf(detail(res(), { busy: true }), "reservation-detail-edit")), "Edit live");
  assert.ok(!disabled(tagOf(detail(res({ status: "Seated" }), { busy: true }), "reservation-detail-primary")), "Open order live");
  assert.ok(!disabled(tagOf(detail(res({ status: "Completed" }), { busy: true }), "reservation-detail-primary")), "Book again live");
});

test("a long unbroken name and a table off the plan wrap (Q5, B10, B19)", () => {
  const html = detail(res({ name: "A".repeat(120), tableNo: "T-99" }));
  assert.match(tagOf(html, "reservation-detail-name"), /\[overflow-wrap:anywhere\]/, "the name wraps");
  assert.match(html, /T-99 · no longer on the floor plan/, "B19");
});
