// Source pins for Menu B2's client wiring (the rules themselves are
// runtime-tested in menu-freshness.test.ts and cart-availability.test.ts):
// the freshness hook is mounted in the grid and creates no query observer, the
// page keeps the grid on a failed background refresh, both order hooks refresh
// the menu on a 409 only, the refresh reads uncached and commits as a real
// fetch, and the cart notice sits above the send notice and shares the
// server's copy. Needles that would appear in this file's own prose are built
// by concatenation.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// CRLF-normalised (like order-availability-paths.test.ts), so the multi-line needles hold on any checkout.
const readRaw = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const readSrc = (rel: string): string => stripComments(readRaw(rel));

const HOOK = "apps/cafe/hooks/use-menu-freshness.ts";
const REFRESH = "apps/cafe/lib/menu-refresh.ts";
const FRESHNESS = "apps/cafe/lib/menu-freshness.ts";
const CART_AVAIL = "apps/cafe/lib/cart-availability.ts";
const NOTICE = "apps/cafe/components/pos/CartUnavailableNotice.tsx";
const WRITE_NOTICE = "apps/cafe/components/pos/WriteNotice.tsx";
const GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const CART = "apps/cafe/components/pos/Cart.tsx";
const CART_PROPS = "apps/cafe/lib/pos-cart-props.ts";
const ORDERS_HOOK = "apps/cafe/hooks/use-orders.ts";

const count = (src: string, needle: string) => src.split(needle).length - 1;

function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  assert.ok(start >= 0, `landmark missing: ${from}`);
  const end = src.indexOf(to, start + 1);
  assert.ok(end > start, `landmark missing after ${from}: ${to}`);
  return src.slice(start, end);
}

/** Index of `needle` in `src`, asserted present (an indexOf of -1 would pass an order check). */
function at(src: string, needle: string): number {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `needle missing: ${needle}`);
  return i;
}

test("M1: ProductGrid mounts the freshness hook once and shows Try again in the count span's slot", () => {
  const src = readSrc(GRID);
  assert.equal(count(src, "useMenuFreshness()"), 1, "the hook is called exactly once");
  assert.ok(src.includes('from "@/hooks/use-menu-freshness"'), "imported from the hook file");
  assert.ok(src.includes("const { refreshFailed, retry } = useMenuFreshness();"));
  const slot = between(src, 'aria-live="polite"', "</span>");
  assert.ok(slot.includes("{refreshFailed ? ("), "the slot switches on refreshFailed");
  assert.ok(slot.includes("onClick={retry}"), "the slot's button retries");
  assert.ok(slot.includes("Couldn&apos;t refresh · Try again"), "plain-English copy");
  assert.ok(slot.includes("min-h-11"), "44px hit area below md");
  assert.ok(slot.includes('{filtered.length === 1 ? "item" : "items"}'), "vision guard: the item count is still there");
  // The flag is used ONLY for the count slot: any other use (in either ternary form, or an
  // early return) could swap the grid out on a failed background refresh (R15-B2).
  assert.equal(count(src, "refreshFailed"), 2, "the destructure plus the one slot ternary, nothing else");
  assert.equal(count(slot, "refreshFailed"), 1, "and that one sits inside the aria-live span");
});

test("M2: the hook creates no query observer, never polls, and is event-driven", () => {
  const raw = readRaw(HOOK);
  const src = readSrc(HOOK);
  assert.ok(raw.length > 500 && src.includes("refreshMenuIfDue(qc"), "vision guard: the hook file was read");
  const forbidden = [
    "use" + "Query(",
    "use" + "Products(",
    "use" + "Categories(",
    "use" + "Queries(",
    "use" + "InfiniteQuery(",
    "use" + "SuspenseQuery(",
    "new Query" + "Observer(",
    "set" + "Interval(",
    "set" + "Timeout(",
    "refetch" + "Interval",
    "requestAnimation" + "Frame(",
  ];
  for (const needle of forbidden) assert.ok(!raw.includes(needle), `use-menu-freshness must not contain ${needle}`);
  assert.ok(src.includes("useSyncExternalStore("), "the failure flag is read from the cache");
  assert.ok(src.includes("qc.getQueryCache().subscribe(onChange)"), "...through the query cache subscription");
  assert.ok(src.includes("qc.getQueryState(key)"), "...via getQueryState");
  assert.ok(src.includes("focusManager.subscribe((focused) => {"), "TanStack focus events");
  assert.ok(
    src.indexOf("if (!focused) return;") > src.indexOf("focusManager.subscribe((focused) => {"),
    "a hide event never refreshes",
  );
  const effect = between(src, "useEffect(() => {", "[qc]);");
  const at2 = (needle: string, from = 0) => {
    const i = effect.indexOf(needle, from);
    assert.ok(i >= 0, `effect landmark missing: ${needle}`);
    return i;
  };
  const defined = at2("const refresh = () => refreshMenuIfDue(qc);");
  const onMount = at2("refresh();", defined);
  const subscribe = at2("focusManager.subscribe((focused) => {");
  const guard = at2("if (!focused) return;", subscribe);
  const onFocus = at2("refresh();", guard);
  assert.ok(defined < onMount && onMount < subscribe, "refresh runs once on mount, before any subscription");
  assert.ok(guard < onFocus, "a hide event returns BEFORE it can refresh");
  assert.ok(at2("return () => {", onFocus) < at2("unsubscribe();"), "the focus subscription is released on cleanup");
  assert.equal(count(effect, "refresh();"), 2, "exactly the mount call and the focus call");
  assert.ok(src.includes('window.addEventListener("focus", refresh)'), "window focus too");
  assert.ok(src.includes('window.removeEventListener("focus", refresh)'), "and it is cleaned up");
  assert.ok(src.includes("refreshMenuIfDue(qc, true)"), "Try again asks for the manual (gap-skipping) refresh");
  // The pure rule and the refresh module poll nowhere either.
  for (const rel of [FRESHNESS, REFRESH]) {
    const s = readRaw(rel);
    assert.ok(s.length > 300, `vision guard: ${rel} was read`);
    for (const needle of ["set" + "Interval(", "set" + "Timeout(", "refetch" + "Interval"]) {
      assert.ok(!s.includes(needle), `${rel} must not contain ${needle}`);
    }
  }
});

test("M3: the page keeps the grid on a failed background refresh and feeds the cart notice the list", () => {
  const src = readSrc(PAGE);
  assert.ok(src.includes(") : products.isError && products.data === undefined ? ("), "error line only when there is no data at all");
  assert.ok(!src.includes(": products.isError ? ("), "the bare isError branch is gone");
  const errorAt = at(src, "products.isError && products.data === undefined");
  assert.ok(at(src, "<ProductGrid") > errorAt, "vision guard: the grid is the branch after the error line");
  assert.ok(src.includes("buildCartProps(pos, () => itemVoid.setOpen(true), products.data)"), "the list reaches buildCartProps");
  const lines = readRaw(PAGE).replace(/\n$/, "").split("\n").length;
  assert.equal(lines, 299, "page.tsx stays at its pinned 299 lines");
});

test("M4: both order hooks refresh the menu on a 409 only and keep the plain refetch for every other error", () => {
  const src = readSrc(ORDERS_HOOK);
  const create = between(src, "export function useCreateOrder", "export function useUpdateOrder");
  const round = between(src, "export function useAddOrderItems", "export function useSettleOrder");
  const gate = "if (isMenuRefusal(err)) void refreshMenuNow(qc).catch(() => undefined);";
  const keep = "else qc.invalidateQueries({ queryKey: PRODUCT_KEYS.all });";
  for (const [name, hook] of [["useCreateOrder", create], ["useAddOrderItems", round]] as const) {
    assert.equal(count(hook, gate), 1, `${name} refreshes on a menu refusal`);
    assert.equal(count(hook, keep), 1, `${name} keeps today's products refetch for every other error`);
    assert.ok(at(hook, gate) < at(hook, keep), `${name}: refresh first, plain refetch as its else`);
    assert.ok(hook.includes("if (toastsFailure(err)) toast.error("), `${name} still toasts the server's message`);
  }
  assert.equal(count(src, "refreshMenuNow(qc)"), 2, "exactly the two call sites");
  assert.ok(
    src.includes("const isMenuRefusal = (err: Error) =>\n  err instanceof ApiError && err.status === MENU_REFUSAL_STATUS;"),
    "a 409 the SERVER answered (ApiError), not a network failure",
  );
  assert.ok(src.includes('import { MENU_REFUSAL_STATUS } from "@/lib/order-availability";'));
  assert.ok(!readRaw(ORDERS_HOOK).includes("5 minutes"), "the stale 5-minute cache claim is gone");
});

test("M5: the refresh reads uncached, cancels first, marks stale, commits as a real fetch, and stamps at start", () => {
  const src = readSrc(REFRESH);
  assert.ok(src.includes('"/api/products?fresh=1"') && src.includes('"/api/categories?fresh=1"'), "both fresh reads");
  assert.equal(count(src, "fetchQuery("), 1, "one commit path");
  assert.ok(src.includes("staleTime: 0"), "fetchQuery must run the read");
  assert.ok(!src.includes("setQueryData("), "a manual write is never persisted by the master provider");
  assert.ok(!src.includes("use" + "Query("), "no observer");
  assert.ok(src.includes('refetchType: "none"'), "invalidate marks stale without fetching");
  const cancel = at(src, "qc.cancelQueries(");
  const invalidate = at(src, "qc.invalidateQueries(");
  const fetchAt = at(src, "qc.fetchQuery(");
  assert.ok(cancel < invalidate && invalidate < fetchAt, "cancel, then mark stale, then fetch");
  assert.ok(at(src, "setLastMenuRefreshAt(Date.now())") < at(src, "await Promise.all("), "stamped before any read starts");
  assert.ok(src.includes("PRODUCT_KEYS.all") && src.includes("CATEGORY_KEYS.all"), "the real query keys");
});

test("M5b: the due check reads the client clock and the bootstrap query; the refresh module stays out of the provider import cycle", () => {
  const hook = readSrc(HOOK);
  const due = between(hook, "export function refreshMenuIfDue", "if (due)");
  assert.ok(due.includes("lastRefreshAt: getLastMenuRefreshAt()"), "the gap is measured from the client stamp");
  assert.ok(due.includes("BOOTSTRAP_QUERY_KEY"), "the bootstrap query is consulted");
  assert.ok(due.includes("bootstrapFetching: qc.isFetching({ queryKey: BOOTSTRAP_QUERY_KEY, exact: true }) > 0"), "bootstrap in flight");
  assert.ok(due.includes("bootstrapFetchedAt: bootstrap?.dataUpdatedAt ? bootstrap.dataUpdatedAt : null"), "bootstrap last real fetch");
  // The only cache state read is the bootstrap query's: a products/categories dataUpdatedAt is the
  // SERVER's `at` when seeded from a stored copy (B2-R5(b)), whatever variable it is read through.
  assert.equal(count(due, "getQueryState("), 1, "one query state is read");
  assert.ok(due.includes("getQueryState(BOOTSTRAP_QUERY_KEY)"), "...the bootstrap's");
  const stamps = due.match(/\w+\??\.(?:dataUpdatedAt|errorUpdatedAt|updatedAt)\b/g) ?? [];
  assert.ok(stamps.length > 0 && stamps.every((m) => m.startsWith("bootstrap")), `only bootstrap stamps are read (got ${stamps.join(", ")})`);
  // hooks/use-orders.ts imports menu-refresh; masters-seed -> use-tables -> use-orders. Importing the provider
  // (or masters-seed) from menu-refresh closes that cycle and crashes at TABLE_KEYS on module evaluation.
  const refresh = readRaw(REFRESH);
  assert.ok(refresh.length > 300, "vision guard: menu-refresh was read");
  for (const banned of ["MasterDataProvider", "masters-seed", "use-orders", "use-tables"]) {
    assert.ok(!new RegExp(`^import[^;]*from "[^"]*${banned}[^"]*";`, "m").test(refresh), `menu-refresh must not import ${banned}`);
  }
  assert.ok(/^import[^;]*from "@\/hooks\/use-products";/m.test(refresh), "vision guard: the import check sees imports");
});

test("M6: the cart mounts one notice, directly above the send notice, locked while busy", () => {
  const src = readSrc(CART);
  assert.equal(count(src, "<CartUnavailableNotice"), 1, "exactly one mount");
  const notice = "<CartUnavailableNotice notice={menuNotice} disabled={isBusy} />";
  const send = "<WriteNoticePanel notice={sendNotice} />";
  const noticeAt = at(src, notice);
  const sendAt = at(src, send);
  assert.ok(noticeAt < sendAt, "notice before the send notice");
  assert.equal(src.slice(noticeAt + notice.length, sendAt).trim(), "", "directly above it, nothing between");
  assert.ok(src.includes("menuNotice?: CartMenuNoticeProps;"), "an optional prop");
  assert.ok(src.includes("  menuNotice,\n"), "destructured");
});

test("M7: buildCartProps threads menuNotice from the list", () => {
  const src = readSrc(CART_PROPS);
  assert.ok(src.includes("export function buildCartProps(pos: Pos, onVoidItem: () => void, menu?: Product[]): CartProps {"));
  assert.ok(src.includes("cartMenuIssues(pos.cart, menu)"), "judged from the list on screen");
  assert.ok(src.includes("menuNotice: menuIssues ? { ...menuIssues, ...cartMenuActions(menuIssues, pos) } : undefined"));
});

test("M8: one price rule and one copy - the notice and the cart verdict import the shared functions", () => {
  const needle = "effective" + "UnitPrice(";
  const files = [CART_AVAIL, NOTICE, HOOK, REFRESH, FRESHNESS, CART_PROPS];
  for (const rel of files) {
    const s = readSrc(rel);
    assert.ok(s.length > 200, `vision guard: ${rel} was read`);
    assert.ok(!s.includes(needle), `${rel} must not carry its own price rule`);
  }
  const avail = readSrc(CART_AVAIL);
  assert.ok(avail.includes("menuLineIssues(menu, unsent)"), "the verdict is the server's function");
  assert.ok(avail.includes("menuIssueSentences(issues)") && avail.includes("menuIssueAction(issues)"), "the copy is the server's builders");
  assert.ok(avail.includes("cart.filter((line) => line.kotRound === 0 && !line.reward)"), "only unsent, non-reward lines");
  for (const s of [avail, readSrc(NOTICE)]) assert.ok(!s.includes("Lucifer"), "no hardcoded cafe name");
});

test("M9: the notice is an amber status panel identical to WriteNotice's changed tone, 360px-safe, buttons locked while busy", () => {
  const notice = readSrc(NOTICE);
  const tone = readSrc(WRITE_NOTICE).match(/changed:\s*"([^"]+)"/);
  assert.ok(tone, "landmark: WriteNotice declares a changed tone");
  assert.ok(notice.includes('role="status"'));
  assert.ok(notice.includes(tone![1]), `the notice carries WriteNotice's changed tone (${tone![1]})`);
  assert.equal(count(notice, "disabled={disabled}"), 2, "both buttons honour disabled");
  // Label -> handler wiring and the render guards (both handlers are () => void: a swap type-checks).
  const remove = between(notice, "{notice.unavailable.length > 0 && (", "Remove them");
  const update = between(notice, "{notice.changed.length > 0 && (", "Update them");
  assert.ok(remove.includes("onClick={notice.onRemoveUnavailable}") && !remove.includes("onUpdateChanged"), "Remove them removes");
  assert.ok(update.includes("onClick={notice.onUpdateChanged}") && !update.includes("onRemoveUnavailable"), "Update them updates");
  assert.equal(count(notice, "onClick={"), 2, "no third handler");
  assert.ok(notice.includes("Remove them") && notice.includes("Update them"));
  assert.ok(notice.includes('"min-h-11 md:min-h-8"'), "44px below md");
  for (const token of ["flex-wrap", "min-w-0", "break-words"]) assert.ok(notice.includes(token), `360px-safe: ${token}`);
});
