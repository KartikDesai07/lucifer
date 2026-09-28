import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  parseListCursor,
  applyCursor,
  nextOrderCursor,
  dedupeOrdersById,
  firstPageOnly,
  onePageAtMost,
  liveOrderOf,
} from "./order-query";
import { GC_TIMES, REFETCH_INTERVALS } from "./query";

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

// ── firstPageOnly: what the Orders page leaves cached as it closes ────────────
// 2026-09-28 slow-network fix: the list is kept for 30 minutes so a return
// visit paints rows at once — but only its first page, so the refetch on
// return is ONE request, not one per page the operator had loaded.

test("firstPageOnly keeps the first page and its param, drops the rest", () => {
  const data = { pages: [["a", "b"], ["c"], ["d"]], pageParams: [undefined, "t1", "t2"] as (string | undefined)[] };
  assert.deepEqual(firstPageOnly(data), { pages: [["a", "b"]], pageParams: [undefined] });
});

test("firstPageOnly returns the SAME object when there is nothing to cut (one page, or no data)", () => {
  const one = { pages: [["a"]], pageParams: [undefined] };
  assert.equal(firstPageOnly(one), one, "one page: reference-equal, so the cache is not rewritten");
  assert.equal(firstPageOnly(undefined), undefined);
});

test("PIN: the Orders list outlives the live lists but still always refetches, and the page trims it to one page as it closes", () => {
  const hooks = readFileSync(fileURLToPath(new URL("../hooks/use-orders.ts", import.meta.url)), "utf8");
  const fnStart = hooks.indexOf("export function useOrdersInfinite");
  const fnBody = hooks.slice(fnStart, hooks.indexOf("\nexport function", fnStart + 1));
  assert.match(fnBody, /gcTime:\s*ORDERS_LIST_GC_MS/, "useOrdersInfinite keeps its list for ORDERS_LIST_GC_MS");
  // Kept longer, never served as fresh: a return visit shows the old rows AND refetches.
  assert.match(fnBody, /staleTime:\s*STALE_TIMES\.LIVE/, "the list must stay always-stale (refetch on every mount)");
  const gc = hooks.match(/const ORDERS_LIST_GC_MS = (\d+) \* (\d+) \* (\d+);/);
  assert.ok(gc, "ORDERS_LIST_GC_MS must be declared as a product of three integers");
  assert.ok(Number(gc![1]) * Number(gc![2]) * Number(gc![3]) > GC_TIMES.ORDERS, "longer than the live lists' gcTime, or the change does nothing");
  // The trim runs as the page unmounts, over every infinite list key.
  assert.match(hooks, /qc\.setQueriesData<[^>]+>>\(\s*\{ queryKey: ORDER_KEYS\.infinite \},\s*\(data\) => firstPageOnly\(data\),?\s*\)/);
  const page = readFileSync(fileURLToPath(new URL("../app/(dashboard)/orders/page.tsx", import.meta.url)), "utf8");
  assert.match(page, /useTrimOrdersListOnLeave\(\);/, "the Orders page must call useTrimOrdersListOnLeave()");
});

// ── F3 S2/S3: the live lists converge across devices (owner decision 3) ─────
// Open tabs and the Orders list's first page poll on the live 30s beat and are
// kept 30 minutes, so a return visit paints at once and then catches up.

test("onePageAtMost: no data or one page is true, two pages is false (reuses firstPageOnly's no-cut identity)", () => {
  assert.equal(onePageAtMost(undefined), true);
  assert.equal(onePageAtMost({ pages: [["a"]], pageParams: [undefined] }), true);
  assert.equal(onePageAtMost({ pages: [["a"], ["b"]], pageParams: [undefined, "t1"] }), false);
});

test("liveOrderOf: the list's row replaces the sheet's snapshot only when it is at least as new", () => {
  const snap = { _id: "o1", updatedAt: "2026-09-28T10:00:00.000Z", total: 540 };
  const newer = { _id: "o1", updatedAt: "2026-09-28T10:05:00.000Z", total: 560 };
  const same = { _id: "o1", updatedAt: "2026-09-28T10:00:00.000Z", total: 541 };
  const older = { _id: "o1", updatedAt: "2026-09-28T09:55:00.000Z", total: 500 };
  assert.equal(liveOrderOf(null, [newer]), null, "no sheet open");
  assert.equal(liveOrderOf(snap, []), snap, "the row is not in the list");
  assert.equal(liveOrderOf(snap, [{ ...newer, _id: "o2" }]), snap, "a different order");
  assert.equal(liveOrderOf(snap, [newer]), newer);
  assert.equal(liveOrderOf(snap, [same]), same, "equal is fresh enough");
  // After an in-sheet settle the snapshot is the fresher Completed doc; the
  // not-yet-refetched row must not bring "Settle & Pay" back.
  assert.equal(liveOrderOf(snap, [older]), snap);
  assert.equal(liveOrderOf(snap, [{ ...newer, updatedAt: "not a date" }]), snap, "an unreadable date keeps the snapshot");
});

test("PIN: open tabs and the Orders list poll on the live beat — the infinite list only while one page is loaded", () => {
  assert.equal(REFETCH_INTERVALS.LIVE_LISTS, 30 * 1000, "the live lists' beat");
  const hooks = readFileSync(fileURLToPath(new URL("../hooks/use-orders.ts", import.meta.url)), "utf8");
  const fnStart = hooks.indexOf("export function useOrdersInfinite");
  const fnBody = hooks.slice(fnStart, hooks.indexOf("\nexport function", fnStart + 1));
  assert.ok(fnStart >= 0, "landmark: useOrdersInfinite exists");
  assert.match(fnBody, /refetchInterval: isMutating \? false : \(query\) => \(onePageAtMost\(query\.state\.data\) \? REFETCH_INTERVALS\.LIVE_LISTS : false\),/);
  // Exported for the POS and Dashboard, and declared AFTER the constant it reads.
  const gcAt = hooks.indexOf("export const ORDERS_LIST_GC_MS = ");
  const optsAt = hooks.indexOf("export const OPEN_TABS_QUERY_OPTIONS = { refetchInterval: REFETCH_INTERVALS.LIVE_LISTS, gcTime: ORDERS_LIST_GC_MS } as const;");
  assert.ok(gcAt >= 0 && optsAt > gcAt, "OPEN_TABS_QUERY_OPTIONS follows ORDERS_LIST_GC_MS");
  assert.match(hooks, /gcTime: options\.gcTime \?\? GC_TIMES\.ORDERS,/, "useOrders takes a gcTime override");
  const pos = readFileSync(fileURLToPath(new URL("../app/(dashboard)/pos/page.tsx", import.meta.url)), "utf8");
  assert.match(pos, /useOrders\(\{ payment: "Unpaid", status: "Pending" \}, OPEN_TABS_QUERY_OPTIONS\)/, "the POS open-tabs list uses the shared options");
});
