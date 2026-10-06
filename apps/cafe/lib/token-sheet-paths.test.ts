import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Print customization S8 (phase 2) — the UI slice: the top-bar Tokens button and its sheet, the token hooks, the
// token chip on the Kitchen card / Orders rows, and the client bundle boundary. Source pins over COMMENT-STRIPPED
// source (behaviour and contract, not formatting). The pure logic these screens render is tested in token-board.test.ts.

const CAFE_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const SHEET = "components/pos/TokenSheet.tsx";
const ROWS = "components/pos/TokenSheetRows.tsx";
const HOOKS = "hooks/use-tokens.ts";
const HEADER = "components/layout/Header.tsx";
const KITCHEN_CARD = "components/kitchen/KitchenOrderCard.tsx";
const ORDER_TABLE = "components/orders/OrderTable.tsx";
const ORDER_SHEET = "components/orders/OrderDetailSheet.tsx";

/** The text of one top-level function: from `function NAME(` to the next top-level function / interface (or file end). */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `landmark: function ${name} exists`);
  const rest = src.slice(start + 10);
  const next = rest.search(/\n(?:export )?(?:function|interface|const|type) /);
  return next < 0 ? src.slice(start) : src.slice(start, start + 10 + next);
}

// ── The button and its gate ────────────────────────────────────────────────────────────────────────────────────────

test("TokenSheet: the button returns null unless printConfigOf(settings).token.enabled, with EVERY hook called before that return", () => {
  const src = read(SHEET);
  const outer = functionBody(src, "TokenSheet");
  const gate = outer.indexOf("return null");
  assert.ok(gate > 0, "landmark: the off gate exists");
  assert.match(outer.slice(0, gate), /if \(!printConfigOf\(settings\.data\)\.token\.enabled\)\s*$/, "the gate is the token switch read through printConfigOf");
  const hooks = Array.from(outer.matchAll(/\buse[A-Z]\w*\(/g));
  assert.ok(hooks.length >= 2, `landmark: the button calls its hooks (${hooks.map((h) => h[0]).join(", ")})`);
  for (const hook of hooks) {
    assert.ok((hook.index ?? Infinity) < gate, `${hook[0]} must be called before the early return (rules of hooks)`);
  }
  assert.match(outer, /useSettings\(\)/, "it reads the cached settings, not a fetch of its own");
  for (const heavy of ["useTokenBoard(", "useTokenAction(", "useTokenRealtime("]) {
    assert.ok(!outer.includes(heavy), `the always-mounted button must not call ${heavy} — only the open sheet's body does`);
  }
});

test("TokenSheet: a Sheet (not a Dialog) on the right, reached from an icon button with an accessible name", () => {
  const src = read(SHEET);
  assert.match(src, /from "@\/components\/ui\/sheet"/);
  assert.match(src, /<SheetContent side="right"/);
  assert.match(src, /<SheetTrigger asChild>/);
  assert.ok(!/components\/ui\/(alert-)?dialog/.test(src), "no Dialog import");
  assert.ok(!/<(Alert)?Dialog/.test(src), "no Dialog element");
  assert.match(src, /aria-label="Tokens"/, "an icon-only button needs a name");
  assert.match(src, /<SheetTitle>/, "a Sheet needs a title for assistive tech");
});

// s82 smoke L3/L4 regression: a MODAL sheet sets pointer-events:none on <body>, so the toaster (portalled under body)
// swallowed every click and the toast's Undo was dead while the sheet was open. The sheet is non-modal, and a press on
// a toast must not dismiss it.
test("TokenSheet: non-modal (the toast Undo stays clickable) and a press on the toaster never closes the sheet", () => {
  const src = read(SHEET);
  assert.match(src, /<Sheet open=\{open\} onOpenChange=\{setOpen\} modal=\{false\}>/, "the Sheet root is modal={false}");
  assert.match(src, /<SheetContent[^>]*onInteractOutside=\{keepOpenForToasts\}/, "SheetContent guards outside presses");
  const guard = functionBody(src, "keepOpenForToasts");
  assert.match(guard, /closest\(TOAST_REGION_SELECTOR\)/);
  assert.match(guard, /event\.preventDefault\(\)/);
  assert.match(src, /TOAST_REGION_SELECTOR = "\[data-sonner-toaster\]"/, "the selector is sonner's toaster attribute");
  assert.equal(count(src, "<Sheet "), 1, "landmark: exactly one Sheet root");
});

test("TokenSheet: the board fetch, its poll, the action hook and the realtime subscription live ONLY in the body, which mounts inside SheetContent", () => {
  const src = read(SHEET);
  const body = functionBody(src, "TokenSheetBody");
  assert.match(body, /useTokenBoard\(\{\s*enabled:\s*true\s*\}\)/);
  assert.match(body, /useTokenAction\(\)/);
  assert.match(body, /useTokenRealtime\(\)/);
  for (const hook of ["useTokenBoard(", "useTokenAction(", "useTokenRealtime("]) {
    assert.equal(count(src, hook), 1, `${hook} is called exactly once in the file`);
    assert.ok(src.indexOf(hook) > src.indexOf("function TokenSheetBody("), `${hook} sits inside the body component`);
  }
  const contentOpen = src.indexOf("<SheetContent");
  const bodyUse = src.indexOf("<TokenSheetBody />");
  const contentClose = src.indexOf("</SheetContent>");
  assert.ok(contentOpen > 0 && bodyUse > contentOpen && bodyUse < contentClose, "the body is rendered inside SheetContent (unmounted while closed)");
});

// ── Per-row in-flight disable ──────────────────────────────────────────────────────────────────────────────────────

test("TokenSheetRows: every action button is disabled while ITS token has a mark in flight, and is a comfortable touch target", () => {
  const src = read(ROWS);
  const buttons = count(src, "<Button");
  assert.ok(buttons >= 3, `landmark: Mark ready, Not ready and Collected buttons exist (${buttons})`);
  assert.match(src, /const busy = inFlight\.has\(entry\.id\)/, "per-id lookup, never a global flag");
  assert.equal(count(src, "disabled={busy}"), buttons, "every button carries the per-id disabled prop");
  assert.equal(count(src, "className={ACTION_CLASS}"), buttons, "every button takes the shared action class");
  assert.match(src, /const ACTION_CLASS = "min-h-11"/, "44px minimum touch target");
  for (const label of ["Mark ready", "Not ready", "Collected"]) assert.ok(src.includes(label), `the ${label} action is labelled`);
  assert.match(src, /key=\{entry\.id\}/, "rows are keyed by the order id");
});

test("TokenSheet: the in-flight id is a per-id Set removed in a FINALLY; the UI uses mutateAsync (never mutate with onSettled, which a second tap would drop)", () => {
  const src = read(SHEET);
  const body = functionBody(src, "TokenSheetBody");
  assert.match(body, /if \(inFlight\.has\(entry\.id\)\) return;/, "a second tap on a busy row is a no-op");
  assert.match(body, /new Set\(current\)\.add\(entry\.id\)/, "added immutably, per id");
  const finallyAt = body.indexOf("finally {");
  assert.ok(finallyAt > 0, "landmark: there is a finally block");
  const removeAt = body.indexOf(".delete(entry.id)");
  assert.ok(removeAt > finallyAt, "the id is removed INSIDE the finally, so success, failure and a thrown error all release the row");
  assert.ok(body.indexOf("act.mutateAsync(") > 0 && body.indexOf("act.mutateAsync(") < finallyAt, "the awaited write sits in the try before it");
  assert.ok(!/\bact\.mutate\(/.test(src), "no fire-and-forget mutate()");
  assert.ok(!src.includes("onSettled"), "no per-call onSettled in the component (the hook owns settling)");
  assert.match(body, /label:\s*"Undo"/, "each mark offers Undo");
  assert.match(body, /undo:\s*"unready"/);
  assert.match(body, /undo:\s*"uncollected"/);
  assert.match(body, /seenFiredAt:\s*action === "ready" \? entry\.firedAt : undefined/, "Ready sends the newest fire instant the screen saw");
});

// ── States ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test("TokenSheet: Skeleton while loading, a guided empty state, an error with Try again, and the tokens-off sentence", () => {
  const src = read(SHEET);
  assert.match(src, /from "@\/components\/ui\/skeleton"/);
  assert.match(src, /<Skeleton\b/, "loading renders skeleton rows");
  assert.ok(
    src.includes("No tokens yet. Every new order gets one. When the kitchen marks an order ready, its token moves to Ready."),
    "the guided empty sentence",
  );
  assert.match(src, /<EmptyState\b/);
  assert.match(src, /<ErrorState\b/);
  assert.match(src, /retryLabel="Try again"/);
  assert.match(src, /onRetry=\{\(\) => void board\.refetch\(\)\}/, "Try again refetches the board");
  assert.ok(src.includes("Tokens are off."), "the tokens-off sentence");
  assert.ok(src.includes("Tokens & numbering"), "and it says where to turn them on");
  assert.match(src, /if \(!data\.enabled\)/, "driven by the server's enabled flag");
  // order of states: error/skeleton only while there is no data at all, so a failed poll never wipes a good list
  const body = functionBody(src, "TokenSheetBody");
  assert.ok(body.indexOf("data === undefined") < body.indexOf("board.isError"), "an error only shows when there is no data to keep showing");
  assert.ok(body.indexOf('title="Ready"') < body.indexOf('title="Preparing"'), "Ready is listed first");
});

// ── The header wiring ──────────────────────────────────────────────────────────────────────────────────────────────

test("Header: exactly one <TokenSheet />, imported from the POS component, placed before <RefreshButton", () => {
  const src = read(HEADER);
  assert.equal(count(src, "<TokenSheet"), 1);
  assert.match(src, /import \{ TokenSheet \} from "@\/components\/pos\/TokenSheet"/);
  assert.ok(src.indexOf("<TokenSheet") < src.indexOf("<RefreshButton"), "before the refresh button");
  assert.ok(src.indexOf("<RefreshButton") < src.indexOf("<PrinterStatusButton"), "landmark: the existing order of the other two is intact");
  const elsewhere = ["components/pos/PosHeader.tsx", "app/(dashboard)/pos/page.tsx", "app/(dashboard)/layout.tsx"];
  for (const rel of elsewhere) assert.ok(!read(rel).includes("<TokenSheet"), `${rel} does not also render it`);
});

test("reachability: routes <- use-tokens <- TokenSheet <- Header <- the dashboard layout", () => {
  const hooks = read(HOOKS);
  assert.ok(hooks.includes('"/api/tokens"'), "use-tokens reads the list route");
  assert.match(hooks, /`\/api\/tokens\/\$\{encodeURIComponent\(id\)\}`/, "and posts to the action route");
  assert.ok(read("app/api/tokens/route.ts").includes("export async function GET("), "landmark: the list route exists");
  assert.ok(read("app/api/tokens/[id]/route.ts").includes("export async function POST("), "landmark: the action route exists");
  assert.match(read(SHEET), /from "@\/hooks\/use-tokens"/);
  assert.match(read(SHEET), /from "@\/components\/pos\/TokenSheetRows"/);
  assert.match(read(HEADER), /from "@\/components\/pos\/TokenSheet"/);
  assert.match(read("app/(dashboard)/layout.tsx"), /import \{ Header \} from "@\/components\/layout\/Header"/);
  assert.match(read("app/(dashboard)/layout.tsx"), /<Header\b/);
  assert.match(read("hooks/use-realtime.ts"), /import \{ TOKEN_KEYS \} from "@\/hooks\/use-tokens"/, "the realtime spec is keyed on the same TOKEN_KEYS");
  assert.match(read(SHEET), /from "@\/hooks\/use-realtime"/);
});

// ── The token chip is rendered only where a token exists ────────────────────────────────────────────────────────────

/** Every `tokenLabelOf(<arg>)` call in `src` must have a defined/number guard on the same expression just before it. */
function assertGuardedLabels(rel: string, arg: string, expectedCalls: number): void {
  const src = read(rel);
  const call = `tokenLabelOf(${arg})`;
  assert.match(src, /import \{ tokenLabelOf \} from "@\/lib\/token-view"/, `${rel} imports the label from the client-safe module`);
  assert.equal(count(src, call), expectedCalls, `${rel}: ${expectedCalls} label call(s)`);
  let from = 0;
  for (let i = 0; i < expectedCalls; i += 1) {
    const at = src.indexOf(call, from);
    from = at + call.length;
    const before = src.slice(Math.max(0, at - 400), at);
    assert.match(
      before,
      new RegExp(`(?:typeof ${escapeRe(arg)} === "number"|${escapeRe(arg)} !== undefined)\\s*&&`),
      `${rel}: label call #${i + 1} is guarded by a defined/number check on ${arg}`,
    );
  }
}

test("KitchenOrderCard / OrderTable (x2) / OrderDetailSheet render tokenLabelOf only under a defined/number check", () => {
  assertGuardedLabels(KITCHEN_CARD, "card.tokenNumber", 1);
  assertGuardedLabels(ORDER_TABLE, "order.tokenNumber", 2);
  assertGuardedLabels(ORDER_SHEET, "order.tokenNumber", 1);
});

// ── The client bundle boundary ─────────────────────────────────────────────────────────────────────────────────────

function sourcesUnder(dirs: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
  };
  for (const d of dirs) walk(path.join(CAFE_ROOT, d));
  return out;
}
const relOf = (file: string): string => path.relative(CAFE_ROOT, file).split(path.sep).join("/");

test("bundle boundary: no UI file imports lib/token-board, lib/token-board-server or a model (screens use lib/token-view)", () => {
  const boardModule = "@/lib/" + "token-board";
  const bannedImport = new RegExp(`from\\s+["'](?:${escapeRe(boardModule)}(?:-server)?|@/models/[^"']*)["']`);
  const files = [...sourcesUnder(["components", "app/(dashboard)"]), path.join(CAFE_ROOT, HOOKS)];
  const rels = files.map(relOf);
  assert.ok(files.length > 100, `landmark: the scan saw the UI tree (${files.length} files)`);
  for (const must of [SHEET, ROWS, HEADER, KITCHEN_CARD, ORDER_TABLE, ORDER_SHEET, HOOKS]) assert.ok(rels.includes(must), `landmark: ${must} is in the scan`);
  const offenders = files.filter((f) => bannedImport.test(stripComments(readFileSync(f, "utf8")))).map(relOf);
  assert.deepEqual(offenders, [], "no UI file may import the server board, its queries, or a Mongoose model");
  // the importers that SHOULD exist do use the client-safe module
  assert.match(read(SHEET), /from "@\/lib\/token-view"/);
  assert.match(read(HOOKS), /from "@\/lib\/token-view"/);
  assert.match(read(ROWS), /from "@\/lib\/token-view"/);
});

// ── The hooks ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("use-tokens: TOKEN_KEYS.action sits under TOKEN_KEYS.all; the board polls on the Kitchen's cadence with LIVE staleness", () => {
  const src = read(HOOKS);
  const all = src.match(/all:\s*\[([^\]]*)\]\s*as const/);
  const action = src.match(/action:\s*\[([^\]]*)\]\s*as const/);
  assert.ok(all && action, "landmark: both keys are declared as literals");
  const allParts = all[1].split(",").map((s) => s.trim());
  const actionParts = action[1].split(",").map((s) => s.trim());
  assert.deepEqual(allParts, ['"tokens"']);
  assert.deepEqual(actionParts.slice(0, allParts.length), allParts, "the action key is prefixed by the board key, so one prefix match holds a nudge while a mark is in flight");
  assert.ok(actionParts.length > allParts.length, "and is strictly longer");
  assert.match(src, /mutationKey:\s*TOKEN_KEYS\.action/);
  assert.match(src, /queryKey:\s*TOKEN_KEYS\.all/);
  assert.match(src, /staleTime:\s*STALE_TIMES\.LIVE/);
  assert.match(src, /refetchInterval:\s*enabled \? REFETCH_INTERVALS\.KITCHEN : false/);
  assert.match(src, /refetchIntervalInBackground:\s*background/, "a wall screen can keep polling in the background");
  assert.match(src, /background = false/, "and the POS sheet does not by default");
  assert.ok(!/\b\d{4,}\b/.test(src), "no raw millisecond literal — the cadence constants only");
  assert.match(read("hooks/use-realtime.ts"), /holdWhileMutating:\s*TOKEN_KEYS\.all/, "the realtime spec holds on that prefix");
});

test("use-tokens: the action is optimistic with a snapshot restore on error, and settling refreshes BOTH the token board and the Kitchen board", () => {
  const src = read(HOOKS);
  const action = src.slice(src.indexOf("export function useTokenAction("));
  assert.ok(action.length > 100, "landmark: the action hook was found");
  const mutate = action.indexOf("onMutate");
  const cancel = action.indexOf("cancelQueries");
  const snapshot = action.indexOf("getQueryData");
  const optimistic = action.indexOf("applyTokenAction(");
  assert.ok(mutate > 0 && cancel > mutate && snapshot > cancel && optimistic > snapshot, "cancel in-flight reads, snapshot, THEN write the optimistic board");
  assert.match(action, /return \{ previous \}/, "the snapshot is the mutation's context");
  const onError = action.slice(action.indexOf("onError"), action.indexOf("onSettled"));
  assert.match(onError, /setQueryData\(TOKEN_KEYS\.all,\s*context\.previous\)/, "an error restores the snapshot, not just invalidates");
  assert.match(onError, /toast\.error\(/, "and says so");
  const settled = action.slice(action.indexOf("onSettled"));
  assert.match(settled, /invalidateQueries\(\{\s*queryKey:\s*TOKEN_KEYS\.all\s*\}\)/);
  assert.match(settled, /invalidateQueries\(\{\s*queryKey:\s*KITCHEN_KEYS\.all\s*\}\)/, "a POS Ready clears the kitchen card too");
  assert.match(src, /import \{ KITCHEN_KEYS \} from "@\/hooks\/use-kitchen"/);
  assert.match(src, /action === "ready" && seenFiredAt \? \{ action, seenFiredAt \} : \{ action \}/, "seenFiredAt rides only a Ready");
});

// ── Hygiene ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("hygiene: the token UI files have no console call and no cafe name, and the sheet files stay inside their line budget", () => {
  const cafeName = "Luci" + "fer";
  for (const rel of [SHEET, ROWS, HOOKS]) {
    const rawSrc = readFileSync(path.join(CAFE_ROOT, rel), "utf8");
    assert.match(rawSrc, /export /, `landmark: ${rel} read`);
    assert.ok(!rawSrc.includes("console" + "."), `${rel}: no console call`);
    assert.ok(!rawSrc.toLowerCase().includes(cafeName.toLowerCase()), `${rel}: no cafe name`);
    assert.ok(!/:\s*any\b|\bas any\b/.test(stripComments(rawSrc)), `${rel}: no any`);
    assert.ok(rawSrc.split("\n").length <= 300, `${rel}: inside the 300-line cap`);
  }
});
