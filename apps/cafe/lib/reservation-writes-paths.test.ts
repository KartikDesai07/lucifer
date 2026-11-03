// U6 Task 1 (2026-11-03): the /reservations page's writes and state hook (design 8.4, 11; Review Focus 1, 2). A write while
// a day, All dates or a search is shown sends today's request and invalidates ["reservations"] once; the list is read ONLY
// through the unfiltered key; nothing polls. Source pins on hooks/use-reservation-writes.ts (against the factory's own
// request, the same hooks the dashboard keeps), hooks/use-reservations-page.ts and the page's wiring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;

const WRITES = "hooks/use-reservation-writes.ts";
const PAGE_HOOK = "hooks/use-reservations-page.ts";
const PAGE = "app/(dashboard)/reservations/page.tsx";

test("the writes are the factory's requests: POST / PUT / DELETE on /api/reservations, each invalidating the root key once on settle", () => {
  const src = read(WRITES);
  const factory = readFileSync(path.join(CAFE_ROOT, "../../packages/shared/src/create-crud-hooks.ts"), "utf8");
  assert.match(factory, /apiSend<T>\(config\.path, "POST", data\)/, "landmark: the factory's POST");
  assert.match(src, /apiSend<Reservation>\("\/api\/reservations", "POST", data\)/, "create: POST /api/reservations with the body");
  assert.match(src, /apiSend<Reservation>\(`\/api\/reservations\/\$\{id\}`, "PUT", data\)/, "update: PUT /api/reservations/{id} with the body");
  assert.match(src, /apiSend<\{ deleted: true \}>\(`\/api\/reservations\/\$\{id\}`, "DELETE"\)/, "delete: DELETE /api/reservations/{id}");
  assert.equal(count(src, "onSettled: () => qc.invalidateQueries({ queryKey: RESERVATION_KEYS.all })"), 3, "each write invalidates ['reservations'] once, in onSettled");
  assert.equal(count(src, "invalidateQueries"), 3, "and nothing else is invalidated or refetched");
  assert.ok(!/refetch|refetchInterval|router\.refresh|setQueryData/.test(src), "no poll, refetch or cache write besides the one invalidation");
});

test("the error toasts keep the factory's words; the success toasts carry the booking", () => {
  const src = read(WRITES);
  assert.match(src, /toast\.error\(err\.message \|\| "Could not book reservation"\)/, "create error");
  assert.match(src, /toast\.error\(err\.message \|\| "Could not update reservation"\)/, "update error");
  assert.match(src, /toast\.error\(err\.message \|\| "Could not delete reservation"\)/, "delete error");
  assert.match(src, /onSuccess: \(saved\) => toast\.success\(bookedToast\(saved\)\)/, "create: the booked toast");
  assert.match(src, /onSuccess: \(saved, vars\) => toast\.success\(vars\.toast\(saved\)\)/, "update: the caller's toast for the saved booking");
  assert.match(src, /toast\.success\(DELETED_TOAST\)/, "delete: today's words");
});

test("the page state reads the list ONLY through useReservations({}) and the tables once; the clock is a tick, never a request", () => {
  const src = read(PAGE_HOOK);
  assert.equal(count(src, "useReservations("), 1, "one list read");
  assert.match(src, /useReservations\(\{\}\)/, "the default (unfiltered) key: the day, the tab and the search never send a GET (design 11)");
  assert.equal(count(src, "useTables()"), 1, "the tables are read once, at the page level (always mounted)");
  assert.match(src, /useNow\(MINUTE_TICK_MS\)/, "a minute tick drives the clock (B12)");
  assert.match(src, /const today = cafeDateString\(new Date\(nowMs\)\);/, "today is the cafe's day (cafeDateString), moving with the tick");
  assert.match(src, /useState<ResDayChoice>\(null\)/, "the day is held as unset (= today, following the clock)");
  assert.ok(!/refetchInterval|setInterval|router\.refresh/.test(src), "no poll of its own");
  assert.match(src, /useMemo\(\(\) => listRows\(list,/, "the rows are memoised on the list's identity (B25)");
});

test("the page runs ONE status-write instance and the page-wide busy flag reads it (B13)", () => {
  const page = read(PAGE);
  assert.equal(count(page, "useReservationUpdate()"), 1, "one useReservationUpdate() in the page");
  assert.match(page, /const busy = updateReservation\.isPending;/, "busy is that instance's isPending");
  assert.ok(!/useUpdateReservation\b/.test(page), "the factory's update hook is not used for status writes");
  assert.ok(!/useReservations\(/.test(page), "the page reads its list through useReservationsPage only");
});
