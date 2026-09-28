// CR1.5 Slice 3 — pure, client-safe helpers for orders cursor pagination.
// No mongoose imports here (plain object manipulation only): app/api/orders/
// route.ts (server) and hooks/use-orders(-infinite).ts (client bundle) share
// these exact semantics instead of each re-deriving cursor math.

interface CreatedAtRange {
  $gte?: Date;
  $lte?: Date;
  $lt?: Date;
}

/**
 * Parse the `?before` cursor query param into a Date. `null` when absent OR
 * when it doesn't parse (`new Date(raw)` invalid) — the route treats a
 * present-but-unparseable cursor as a 400, never a silently-ignored filter.
 */
export function parseListCursor(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Tighten `query.createdAt`'s `$lt` bound to `cursor`, MERGING into whatever
 * the `date` filter already built (`{$gte, $lte}`) — the `$gte` lower bound
 * (and any `$lte`) must survive untouched. If a `$lt` is already present
 * (e.g. a repeated call), keep the EARLIER of the two so the page can only
 * ever narrow, never re-widen.
 *
 * Documented-unspecified tie behavior (CR1 accepted): a strict `$lt` cursor
 * means any order sharing the boundary row's exact createdAt millisecond may
 * be skipped across the page split, instead of appearing exactly once. This
 * is v1-grade — accepted for CR1. The upgrade path is a composite
 * (createdAt, _id) cursor, which breaks same-millisecond ties deterministically.
 */
export function applyCursor(query: Record<string, unknown>, cursor: Date): void {
  const existing = (query.createdAt as CreatedAtRange | undefined) ?? {};
  const lt = existing.$lt && existing.$lt < cursor ? existing.$lt : cursor;
  query.createdAt = { ...existing, $lt: lt };
}

/**
 * The cursor for the NEXT page, or `undefined` when there isn't one. A page
 * shorter than `pageSize` means the server ran out of rows — the client must
 * stop paging rather than refetch an identical short page forever.
 *
 * Same same-millisecond caveat as `applyCursor` above: this cursor is the
 * last row's exact createdAt, so a tie at that millisecond may be skipped —
 * accepted for CR1 (v1-grade).
 */
export function nextOrderCursor(
  page: { createdAt: string | Date }[],
  pageSize: number,
): string | undefined {
  if (page.length < pageSize) return undefined;
  const last = page[page.length - 1];
  return new Date(last.createdAt).toISOString();
}

/**
 * Flatten infinite-query pages into one list, dropping later duplicates by
 * `_id`. Boundary rows can repeat across pages (a new order lands between
 * fetches, shifting the cursor row into both the old and new page) — the
 * FIRST occurrence (the earlier page, so the correct newest-first position)
 * wins; later repeats are dropped.
 */
export function dedupeOrdersById<T extends { _id: string }>(pages: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const order of page) {
      if (seen.has(order._id)) continue;
      seen.add(order._id);
      out.push(order);
    }
  }
  return out;
}

/**
 * An infinite-query result cut back to its FIRST page — what the Orders page
 * leaves in the cache as it closes. TanStack refetches EVERY kept page, one
 * after another, when a list comes back into use, so a list someone paged
 * through ten times would cost ten sequential requests on the next visit (on
 * a slow counter link, seconds). The first page is all a returning operator
 * needs to see at once; older pages load on "Load more" as before. Returns
 * the same object when there is nothing to cut, so an unchanged cache stays
 * reference-equal.
 */
export function firstPageOnly<TPage, TParam>(
  data: { pages: TPage[]; pageParams: TParam[] } | undefined,
): { pages: TPage[]; pageParams: TParam[] } | undefined {
  if (!data || data.pages.length <= 1) return data;
  return { pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

/**
 * True while an infinite list holds at most one page — the only shape the
 * Orders list may poll in (a timer must never re-fetch every loaded page in
 * sequence). The same "nothing to cut" identity firstPageOnly already returns.
 */
export function onePageAtMost(data: { pages: unknown[]; pageParams: unknown[] } | undefined): boolean {
  return firstPageOnly(data) === data;
}

/**
 * The order a detail sheet should show: the list's row for it when that row is
 * at least as new as the sheet's own snapshot, otherwise the snapshot. After a
 * settle inside the sheet the snapshot is the fresher Completed order, and a
 * not-yet-refetched Pending row must not bring "Settle & Pay" back. An
 * unreadable date keeps the snapshot.
 */
export function liveOrderOf<T extends { _id: string; updatedAt: string }>(
  snap: T | null,
  rows: readonly T[],
): T | null {
  if (!snap) return null;
  const row = rows.find((r) => r._id === snap._id);
  if (!row) return snap;
  return Date.parse(row.updatedAt) >= Date.parse(snap.updatedAt) ? row : snap;
}
