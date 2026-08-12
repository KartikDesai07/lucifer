import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseListCursor,
  applyCursor,
  nextOrderCursor,
  dedupeOrdersById,
} from "./order-query";

// CR1.5 Slice 3 — orders cursor pagination. `order-query.ts` is PURE (no
// mongoose), so this suite is DB-free start to finish.

// ── parseListCursor ───────────────────────────────────────────────────────

test("parseListCursor: null/absent → null", () => {
  assert.equal(parseListCursor(null), null);
});

test("parseListCursor: an unparseable string → null (not a thrown error)", () => {
  assert.equal(parseListCursor("not-a-date"), null);
  assert.equal(parseListCursor(""), null);
});

test("parseListCursor: a valid ISO string parses to the same instant", () => {
  const iso = "2026-08-10T12:00:00.000Z";
  const parsed = parseListCursor(iso);
  assert.ok(parsed instanceof Date);
  assert.equal(parsed?.toISOString(), iso);
});

// ── applyCursor: merges with the date filter's {$gte,$lte}, tightens $lt ───

test("applyCursor on a bare query sets $lt without touching anything else", () => {
  const query: Record<string, unknown> = {};
  const cursor = new Date("2026-08-10T10:00:00.000Z");
  applyCursor(query, cursor);
  assert.deepEqual(query.createdAt, { $lt: cursor });
});

test("applyCursor MERGES into an existing {$gte,$lte} range — $gte survives, $lte survives, $lt is added", () => {
  const gte = new Date("2026-08-10T00:00:00.000Z");
  const lte = new Date("2026-08-10T23:59:59.999Z");
  const query: Record<string, unknown> = { createdAt: { $gte: gte, $lte: lte } };
  const cursor = new Date("2026-08-10T12:00:00.000Z");

  applyCursor(query, cursor);

  assert.deepEqual(query.createdAt, { $gte: gte, $lte: lte, $lt: cursor });
});

test("applyCursor tightens $lt to the EARLIER of an existing $lt and the new cursor", () => {
  const gte = new Date("2026-08-10T00:00:00.000Z");
  const existingLt = new Date("2026-08-10T09:00:00.000Z"); // earlier than the new cursor
  const query: Record<string, unknown> = { createdAt: { $gte: gte, $lt: existingLt } };
  const laterCursor = new Date("2026-08-10T12:00:00.000Z");

  applyCursor(query, laterCursor);

  assert.deepEqual(
    query.createdAt,
    { $gte: gte, $lt: existingLt },
    "the existing, earlier $lt must win — the page can only narrow, never re-widen",
  );
});

test("applyCursor replaces $lt when the new cursor is earlier than the existing one", () => {
  const gte = new Date("2026-08-10T00:00:00.000Z");
  const existingLt = new Date("2026-08-10T12:00:00.000Z");
  const query: Record<string, unknown> = { createdAt: { $gte: gte, $lt: existingLt } };
  const earlierCursor = new Date("2026-08-10T09:00:00.000Z");

  applyCursor(query, earlierCursor);

  assert.deepEqual(query.createdAt, { $gte: gte, $lt: earlierCursor });
});

// ── nextOrderCursor ──────────────────────────────────────────────────────

test("nextOrderCursor: a page shorter than pageSize → undefined (no more pages)", () => {
  const page = [{ createdAt: "2026-08-10T10:00:00.000Z" }];
  assert.equal(nextOrderCursor(page, 50), undefined);
});

test("nextOrderCursor: an empty page → undefined", () => {
  assert.equal(nextOrderCursor([], 50), undefined);
});

test("nextOrderCursor: a full page → the last row's createdAt as an ISO string", () => {
  const page = [
    { createdAt: "2026-08-10T12:00:00.000Z" },
    { createdAt: "2026-08-10T10:00:00.000Z" },
  ];
  assert.equal(nextOrderCursor(page, 2), "2026-08-10T10:00:00.000Z");
});

test("nextOrderCursor: accepts a Date instance too, always returns an ISO string", () => {
  const page = [{ createdAt: new Date("2026-08-10T10:00:00.000Z") }];
  assert.equal(nextOrderCursor(page, 1), "2026-08-10T10:00:00.000Z");
});

// ── dedupeOrdersById ─────────────────────────────────────────────────────
// Doc-only note (no code change, F): the strict `$lt` cursor's same-millisecond
// tie behavior is documented-unspecified-accepted for CR1 (see the comments on
// applyCursor/nextOrderCursor in order-query.ts) — an order sharing the
// boundary row's exact createdAt millisecond may be skipped by dedupeOrdersById
// never seeing it at all, not just deduped away.

test("dedupeOrdersById flattens pages and drops the boundary duplicate, keeping order", () => {
  const pageA = [{ _id: "3" }, { _id: "2" }];
  // A new order landed between fetches, shifting "_id: 2" into page B too —
  // the boundary row repeats.
  const pageB = [{ _id: "2" }, { _id: "1" }];

  const result = dedupeOrdersById([pageA, pageB]);

  assert.deepEqual(
    result.map((o) => o._id),
    ["3", "2", "1"],
    "the earlier page's copy of the boundary row wins, order preserved",
  );
});

test("dedupeOrdersById with no duplicates returns every row, in page order", () => {
  const pageA = [{ _id: "a" }, { _id: "b" }];
  const pageB = [{ _id: "c" }];
  assert.deepEqual(
    dedupeOrdersById([pageA, pageB]).map((o) => o._id),
    ["a", "b", "c"],
  );
});

test("dedupeOrdersById on zero pages → an empty list", () => {
  assert.deepEqual(dedupeOrdersById([]), []);
});

// ── PIN: useOrdersInfinite mirrors useOrders' pause-while-mutating focus-refetch ──
// Arbiter-confirmed: useOrdersInfinite dropped the documented contract (only
// staleTime/gcTime were set) — the global default is refetchOnWindowFocus:false,
// so returning to the tab during service never refreshed the orders list. Fixed
// by mirroring the same useIsMutating mechanism useOrders already uses.

test("PIN: useOrdersInfinite sets refetchOnWindowFocus: !isMutating", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../hooks/use-orders.ts", import.meta.url)),
    "utf8",
  );
  const fnStart = src.indexOf("export function useOrdersInfinite");
  assert.ok(fnStart >= 0, "useOrdersInfinite must exist");
  const nextFnStart = src.indexOf("\nexport function", fnStart + 1);
  const fnBody = src.slice(fnStart, nextFnStart === -1 ? undefined : nextFnStart);
  assert.match(
    fnBody,
    /refetchOnWindowFocus:\s*!isMutating/,
    "useOrdersInfinite must set refetchOnWindowFocus: !isMutating",
  );
});

// ── PIN: the orders page distinguishes a failed Load-more from a first-load error ──
// Arbiter-confirmed (probe): a failed fetchNextPage keeps the loaded pages but
// flips orders.isError, and the page rendered the full-page error BEFORE the
// list — erasing an already-populated table. Fixed by gating the full-page
// error on `!orders.data` and using `isFetchNextPageError` to show an inline
// retry instead when pages already exist.

test("PIN: the orders page uses isFetchNextPageError to distinguish a Load-more failure", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../app/(dashboard)/orders/page.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(src, /isFetchNextPageError/);
});
