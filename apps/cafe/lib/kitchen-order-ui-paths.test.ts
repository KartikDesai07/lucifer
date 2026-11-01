import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// KOT kitchen order (2026-11-01) -- client source pins. Each reads the ACTUAL
// source; every negative pin is paired with a positive landmark.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const PAGE = "apps/cafe/app/(dashboard)/categories/page.tsx";
const PANEL = "apps/cafe/components/menu/KitchenOrderPanel.tsx";
const LIST = "apps/cafe/components/menu/CategoryArrangeList.tsx";
const HOOK = "apps/cafe/hooks/use-categories.ts";

const PAGE_LINE_CAP = 327;

// The body of `export function <name>(` up to the next top-level `\n}`.
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = src.indexOf("\n}", start);
  assert.ok(end > start, `${name} must close`);
  return src.slice(start, end);
}

test("page: mounts KitchenOrderPanel and no longer imports CategoryArrangeList directly; stays within its line cap", () => {
  const page = readStripped(PAGE);
  assert.ok(page.includes("<KitchenOrderPanel"), "landmark: the page mounts the panel");
  assert.ok(page.includes('from "@/components/menu/KitchenOrderPanel"'), "landmark: the panel import");
  assert.ok(!page.includes("CategoryArrangeList"), "the page must not reference the list directly");
  const lines = (readSrc(PAGE).match(/\n/g) ?? []).length;
  assert.ok(lines <= PAGE_LINE_CAP, `page is ${lines} lines, cap ${PAGE_LINE_CAP}`);
});

test("panel: SegmentedControl + AlertDialog confirm + clear hook + a kitchen list, a menu list too", () => {
  const panel = readStripped(PANEL);
  assert.ok(panel.includes("<SegmentedControl"), "segmented switch");
  assert.ok(panel.includes('from "@/components/ui/segmented-control"'), "kit import");
  assert.ok(panel.includes("<AlertDialog>"), "clear is confirmed in an AlertDialog");
  assert.ok(panel.includes("useClearKitchenOrder()"), "clear hook is called");
  // Review LOW (race): Clear is disabled while ANY arrangement write is in flight, and the list pauses during a clear.
  assert.ok(panel.includes("useIsMutating({ mutationKey: CATEGORY_KEYS.arrange }) > 0"), "panel watches the shared key");
  assert.ok(panel.includes("disabled={arranging}") && !panel.includes("disabled={clear.isPending}"), "Clear waits for a drag save");
  assert.ok(panel.includes("clear.mutate()"), "the confirm action fires the clear");
  assert.ok(panel.includes('list="kitchen"'), "kitchen list mounted");
  assert.ok(panel.includes('list="menu"'), "menu list mounted unchanged");
  assert.ok(panel.includes("kitchenOrderIsSet("), "the Not-set copy and Clear button key off kitchenOrderIsSet");
  assert.ok(!/<select\b/i.test(panel), "no native select");
  assert.ok(!/type="(date|time|datetime-local|color)"/.test(panel), "no native pickers");
});

test("list: kitchen ids come from kitchenArrangement; the hook gets the list kind", () => {
  const list = readStripped(LIST);
  assert.ok(list.includes("useReorderCategories(list)"), "the list passes its kind to the hook");
  assert.ok(list.includes("const saving = useIsMutating({ mutationKey: CATEGORY_KEYS.arrange }) > 0;"), "a clear pauses the list too");
  assert.ok(list.includes("kitchenArrangement(categories)"), "kitchen id order");
  assert.ok(list.includes('list = "menu"'), "default kind is menu");
  // initial state, re-seed key, and the rollback ref all share the one id source.
  assert.ok(list.includes("useState<string[]>(idsOf)"), "initial state from idsOf");
  assert.ok(list.includes("idsOf().join("), "re-seed key from idsOf");
  assert.ok(list.includes("latestServerIdsRef.current = idsOf()"), "rollback ref from idsOf");
  assert.ok(!list.includes("latestServerIdsRef.current = categories.map"), "ref no longer bypasses idsOf");
});

test("hook: menu body is exactly { ids }; list: kitchen is sent only for the kitchen kind", () => {
  const hook = readStripped(HOOK);
  const reorder = fnBody(hook, "useReorderCategories");
  assert.ok(reorder.includes('list: CategoryArrangeListKind = "menu"'), "landmark: defaults to menu");
  assert.ok(reorder.includes('"PATCH"'), "landmark: PATCH call");
  assert.ok(reorder.includes('list === "kitchen" ? { ids, list } : { ids }'), "menu body is { ids }, kitchen adds list");
  assert.ok(!/\{\s*ids\s*,\s*list\s*\}\s*\)/.test(reorder), "the list key is never sent unconditionally");
  assert.ok(reorder.includes("commitCategories(qc, fresh)"), "landmark: success commits the response");
  assert.ok(!reorder.includes("onSettled"), "G3: no onSettled invalidate");
  assert.ok(reorder.includes('"Could not save the new order"'), "landmark: reorder error copy kept");
  assert.ok(reorder.includes("mutationKey: CATEGORY_KEYS.arrange,"), "the reorder shares the arrange key");
});

test("hook: useClearKitchenOrder PATCHes { list: kitchen, clear: true }, commits, toasts", () => {
  const hook = readStripped(HOOK);
  const clear = fnBody(hook, "useClearKitchenOrder");
  assert.ok(clear.includes('{ list: "kitchen", clear: true }'), "clear body");
  assert.ok(clear.includes("mutationKey: CATEGORY_KEYS.arrange,"), "the clear shares the arrange key");
  assert.ok(clear.includes('"PATCH"'), "landmark: PATCH");
  assert.ok(clear.includes("commitCategories(qc, fresh)"), "commits the fresh list");
  assert.ok(clear.includes('toast.success("Kitchen order cleared")'), "success toast");
  assert.ok(clear.includes('toast.error("Could not clear the kitchen order")'), "error toast");
  assert.ok(clear.includes("/api/categories?fresh=1"), "error path re-reads fresh");
  assert.ok(!clear.includes("onSettled"), "G3: no onSettled invalidate");
});
