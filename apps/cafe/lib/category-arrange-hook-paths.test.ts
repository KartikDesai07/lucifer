// Source pins for the Categories drag-and-drop arrangement's hook/component
// layer (CategoryArrangeList, CategoryRow, useReorderCategories/
// useCreateCategory in hooks/use-categories.ts). Split out of
// lib/menu-categories-paths.test.ts (which stayed on the Categories PAGE:
// delete/rename copy, AdminGuard, MENU_SECTIONS) once this half grew past the
// line ceiling across the G2/G3/N1 fix rounds (Menu redesign, slice C,
// 2026-09-30). Same readSrc + stripComments idiom as the sibling file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const ARRANGE_LIST = "apps/cafe/components/menu/CategoryArrangeList.tsx";
const CATEGORY_ROW = "apps/cafe/components/menu/CategoryRow.tsx";
const USE_CATEGORIES = "apps/cafe/hooks/use-categories.ts";

// ══════════════════════════════════════════════════════════════════════════
// Reorder: explicit rollback to the LATEST server ids, full id list sent,
// error recovery. G2 (arbiter-confirmed): TanStack Query's mutation.js runs
// the hook's own onError/onSettled BEFORE the per-call mutate() onError, so
// a rollback to the pre-drag `previous` snapshot would overwrite a fresher
// ?fresh=1 re-seed the hook just wrote -- the fix rolls back to a ref kept
// current every render instead of a stale closure.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: CategoryArrangeList rolls back to the LATEST server ids on a failed save, not a stale pre-drag snapshot (G2)", () => {
  const src = readStripped(ARRANGE_LIST);

  // Positive landmark: the optimistic order state itself.
  assert.match(src, /const \[order, setOrder\] = useState<string\[\]>\(/, "the arrange list must keep its own optimistic order state");

  // The ref must be kept current on every render (not inside an effect keyed
  // on a dependency array, which could read stale on the very render a fresh
  // server list arrives), and the rollback must read that ref, not a
  // `previous` variable closed over when the drag started.
  assert.match(
    src,
    /const latestServerIdsRef = useRef<string\[\]>\(categories\.map\(\(c\) => c\._id\)\);\s*\n\s*latestServerIdsRef\.current = categories\.map\(\(c\) => c\._id\);/,
    "a ref tracking the latest server ids must be assigned unconditionally every render (not inside useEffect)",
  );
  assert.match(
    src,
    /reorder\.mutate\(next,\s*\{\s*onError:\s*\(\)\s*=>\s*setOrder\(latestServerIdsRef\.current\)\s*\}\)/,
    "a failed save must roll back to latestServerIdsRef.current, not a pre-drag `previous` snapshot",
  );
  assert.ok(!/setOrder\(previous\)/.test(src), "the rollback must no longer reference a stale `previous` snapshot (G2 fix)");
});

test("PIN: useReorderCategories sends the FULL ordered id list on every save, not a partial range", () => {
  const src = readStripped(USE_CATEGORIES);
  assert.match(src, /export function useReorderCategories\(/, "useReorderCategories must be exported");
  assert.match(
    src,
    /apiSend<Category\[\]>\("\/api\/categories",\s*"PATCH",\s*\{\s*ids\s*\}\)/,
    "the PATCH body must be { ids } built from the mutation's own argument (the whole order array), not a slice of it",
  );
  // The mutationFn's parameter itself must be the whole array (ids: string[]),
  // not e.g. { id, index } for one moved row.
  assert.match(src, /mutationFn:\s*\(ids:\s*string\[\]\)/, "the mutation must take the whole id array as its argument");
});

test("PIN: useReorderCategories recovers from ANY error (not just a 409) by reading the live list back (?fresh=1), and never relies on an onSettled invalidate (G3)", () => {
  const src = readStripped(USE_CATEGORIES);

  // Positive landmark: the mutation's onError handler itself.
  const onErrorStart = src.indexOf("onError: async (err: Error) => {");
  assert.ok(onErrorStart >= 0, "useReorderCategories must have an async onError handler");
  const onErrorEnd = src.indexOf("},", onErrorStart);
  const onErrorBody = src.slice(onErrorStart, onErrorEnd);

  // G3: the fresh re-read must run unconditionally in onError -- not gated
  // behind an `if (... status === 409)` branch, which would leave a
  // non-409 failure (e.g. a network error) showing a stale optimistic order.
  assert.match(
    onErrorBody,
    /apiGet<Category\[\]>\("\/api\/categories\?fresh=1"\)/,
    "every error path must re-read the uncached list via ?fresh=1",
  );
  assert.match(
    onErrorBody,
    /commitCategories\(qc,\s*fresh\)/,
    "the fresh list must be written back via commitCategories (N1), not setQueryData",
  );
  assert.ok(
    !/if\s*\(\s*err instanceof ApiError\s*&&\s*err\.status === 409\s*\)\s*\{[\s\S]{0,50}apiGet/.test(src),
    "the ?fresh=1 recovery must not be gated behind the 409 check -- it must run for every error",
  );
  // The 409 branch still gets the server's own copy; other errors get the
  // hook's own generic copy -- both from the SAME toast.error call, not two
  // separate ones inside an if/else that would gate the recovery too.
  assert.match(onErrorBody, /err instanceof ApiError && err\.status === 409/, "the toast copy must still distinguish a 409 from any other error");
  assert.match(onErrorBody, /toast\.error\(is409 \? err\.message : "Could not save the new order"\)/, "a 409 toasts the server's own message; anything else toasts the generic copy");

  // G3: no onSettled invalidate -- its refetch could race a fresher
  // cache write and paint a per-instance-cached stale list back over it.
  assert.ok(!/onSettled/.test(src), "useReorderCategories must not invalidate on settle -- every cache write goes through commitCategories directly");

  // N1: the reorder's own success must also commit via commitCategories, not
  // a bare setQueryData -- see the dedicated N1 test below for why.
  assert.match(src, /onSuccess:\s*\(fresh\)\s*=>\s*commitCategories\(qc,\s*fresh\)/, "onSuccess must commit the PATCH response via commitCategories");
});

test("PIN: useCreateCategory appends the created doc and commits it via commitCategories, not setQueryData (R12 + N1)", () => {
  const src = readStripped(USE_CATEGORIES);
  assert.match(src, /export function useCreateCategory\(/, "useCreateCategory must be hand-written (exported as a function), not the factory's useCreate");
  assert.match(
    src,
    /const prev = qc\.getQueryData<Category\[\]>\(CATEGORY_KEYS\.all\);\s*\n\s*commitCategories\(qc,\s*prev \? \[\.\.\.prev, created\] : \[created\]\);/,
    "onSuccess must append the created doc to the current cached list and commit it via commitCategories",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// N1 (arbiter-confirmed) -- MasterDataProvider (see MasterDataProvider.tsx)
// writes the offline device blob ONLY on a real fetch success; it stamps
// every queryClient.setQueryData() call manual:true internally and its cache
// subscriber skips those on sight. A bare setQueryData after reorder/create/
// error-recovery would update the in-memory cache but never reach the
// device's stored copy -- a reload, or staying offline, would keep showing
// the OLD category list. Fix: commitCategories() routes every write through
// qc.fetchQuery with a trivial network-free queryFn and staleTime: 0, so
// query-core's own fetch-success dispatch (which carries no manual flag)
// fires for real every time.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: commitCategories writes through a REAL fetchQuery (staleTime: 0, a network-free queryFn), never setQueryData -- so the offline device blob stays in sync (N1)", () => {
  const src = readStripped(USE_CATEGORIES);

  // Positive landmark: the helper itself.
  assert.match(src, /function commitCategories\(qc: QueryClient, list: Category\[\]\): Promise<Category\[\]>/, "commitCategories must be declared with this signature");

  const helperStart = src.indexOf("function commitCategories");
  assert.ok(helperStart >= 0, "landmark: commitCategories must be found");
  const helperEnd = src.indexOf("\n}\n", helperStart);
  const helperBody = src.slice(helperStart, helperEnd);

  assert.match(helperBody, /qc\.fetchQuery\(\{/, "commitCategories must call qc.fetchQuery, the real-fetch API, not qc.setQueryData");
  assert.match(helperBody, /queryKey:\s*CATEGORY_KEYS\.all/, "it must target the categories query key");
  assert.match(helperBody, /queryFn:\s*\(\)\s*=>\s*Promise\.resolve\(list\)/, "the queryFn must resolve the given list with no network call");
  assert.match(helperBody, /staleTime:\s*0/, "staleTime: 0 forces fetchQuery to actually run the queryFn (and dispatch) every time");

  // Vision guard + regression net: NO write site in this file may still use
  // the old setQueryData<Category[]> pattern for the categories key -- every
  // one of them must go through commitCategories instead.
  assert.ok(
    !/setQueryData<Category\[\]>\(CATEGORY_KEYS\.all/.test(src),
    "no write site may call setQueryData<Category[]>(CATEGORY_KEYS.all, ...) directly -- every commit must go through commitCategories (N1)",
  );
});

// ══════════════════════════════════════════════════════════════════════════
// Arrows (WCAG 2.5.7 single-pointer alternative) + touch-action on the
// handle only.
// ══════════════════════════════════════════════════════════════════════════

test("PIN: CategoryRow renders up/down arrow buttons with aria-labels naming the category, sized for touch", () => {
  const src = readStripped(CATEGORY_ROW);
  assert.match(src, /aria-label=\{`Move \$\{category\.name\} up`\}/, "the up arrow must have an aria-label naming the category");
  assert.match(src, /aria-label=\{`Move \$\{category\.name\} down`\}/, "the down arrow must have an aria-label naming the category");
  assert.match(src, /h-11 w-11[^"]*md:h-9 md:w-9/, "the arrows must be h-11 w-11 below md and h-9 w-9 at md+ (R23)");
  // R23: aria-disabled + a guard, never the `disabled` attribute (which would
  // drop keyboard focus while a save is pending).
  assert.match(src, /aria-disabled=\{index === 0 \|\| disabled\}/, "the up arrow must use aria-disabled, not disabled");
  assert.match(src, /aria-disabled=\{index === total - 1 \|\| disabled\}/, "the down arrow must use aria-disabled, not disabled");
  // Scoped to the two arrow buttons only -- the grip drag handle legitimately
  // uses the real `disabled` attribute (dragging itself, unlike a keyboard
  // arrow press, has no focus to preserve once dnd-kit's own listeners stop).
  const upButtonStart = src.indexOf('aria-label={`Move ${category.name} up`}');
  const downButtonStart = src.indexOf('aria-label={`Move ${category.name} down`}');
  assert.ok(upButtonStart >= 0 && downButtonStart >= 0, "landmark: both arrow buttons must be found by their aria-label");
  const upButtonTag = src.slice(src.lastIndexOf("<button", upButtonStart), src.indexOf(">", upButtonStart));
  const downButtonTag = src.slice(src.lastIndexOf("<button", downButtonStart), src.indexOf(">", downButtonStart));
  assert.ok(!upButtonTag.includes(" disabled="), "the up arrow must not use the `disabled` attribute keyed on the pending save");
  assert.ok(!downButtonTag.includes(" disabled="), "the down arrow must not use the `disabled` attribute keyed on the pending save");
});

test("PIN: touch-action:none sits ONLY on the drag handle, never on the row itself -- the page must keep scrolling on a phone", () => {
  const src = readStripped(CATEGORY_ROW);
  // Positive landmark: the drag handle itself, carrying the dnd-kit listeners.
  const handleStart = src.indexOf("{...attributes}");
  assert.ok(handleStart >= 0, "the drag handle must spread dnd-kit's {...attributes} and {...listeners}");
  const handleTagStart = src.lastIndexOf("<button", handleStart);
  const handleTagEnd = src.indexOf(">", handleStart);
  const handleTag = src.slice(handleTagStart, handleTagEnd);
  assert.ok(handleTag.includes("touch-none"), "the drag handle button must carry touch-none (touch-action: none)");

  // Negative: the outer <li> row wrapper must not carry touch-none.
  const rowTagStart = src.indexOf("<li");
  const rowTagEnd = src.indexOf(">", rowTagStart);
  assert.ok(rowTagStart >= 0 && rowTagEnd > rowTagStart, "landmark: the row's own <li> wrapper must exist");
  assert.ok(!src.slice(rowTagStart, rowTagEnd).includes("touch-none"), "the row wrapper must NOT carry touch-none, or the page could not scroll under it");
});

test("PIN: dragging and the arrows both pause while a save is pending", () => {
  const src = readStripped(ARRANGE_LIST);
  assert.match(src, /disabled=\{saving\}/, "the CategoryRow must receive disabled={saving}");
  const rowSrc = readStripped(CATEGORY_ROW);
  assert.match(rowSrc, /useSortable\(\{\s*id:\s*category\._id,\s*disabled,\s*\}\)/, "useSortable must receive the disabled flag, pausing drag during a save");
});
