// U3 Task 6 (2026-10-29): the Floor's loading, no-tables and filtered-empty states, and Seat now / Free table in the HTML
// confirm sheet (design 6.6, 6.7, 11 in docs/superpowers/specs/2026-10-28-floor-match-html-design.md; values 5.2 in
// docs/superpowers/specs/2026-10-28-floor-html-values.md). The class strings (values 5.2's empty line, U2's empty box and
// 40px buttons mirrored, the tile-shaped skeleton), renders of FloorSkeleton, FloorEmptyState (admin, staff, the session
// loading) and FloorFilterEmpty, then source pins: the page's branch order, the confirm's sheet look and the close that
// the hook ignores while a write runs (the brief: the sheet must keep that path).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

import { stripComments } from "./source-pin-utils";
import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import {
  FLOOR_EMPTY_ACCENT_BUTTON_CLASS, FLOOR_EMPTY_CLASS, FLOOR_EMPTY_OUTLINE_BUTTON_CLASS, FLOOR_EMPTY_TITLE_CLASS,
  FLOOR_SKELETON_TILE_CLASS,
} from "./floor-layout";
import { FLOOR_TILE_CLASS } from "./floor-tile-classes";
import { FLOOR_EMPTY_FILTER_TEXT, FLOOR_GRID_CLASS } from "./floor-tiles";
import { TABLES_SETUP_PATH } from "./table-sections";
import { ORDERS_OUTLINE_BUTTON_CLASS } from "@/components/orders/OrdersListParts";
import { FloorEmptyState, FloorFilterEmpty, FloorSkeleton } from "@/components/tables/FloorStates";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const sorted = (cls: string[]): string[] => [...cls].sort();
const count = (s: string, needle: string): number => s.split(needle).length - 1;

const PAGE = "app/(dashboard)/tables/page.tsx";
const STATES = "components/tables/FloorStates.tsx";
const DIALOGS = "components/tables/FloorDialogs.tsx";
const CONFIRM = "components/shared/ConfirmDialog.tsx";
const ACTIONS_HOOK = "hooks/use-floor-actions.ts";

/** The `{ ... }` body that starts at the first `{` after `needle`. */
function bodyAfter(src: string, needle: string): string {
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `landmark: ${needle}`);
  const open = src.indexOf("{", at + needle.length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  assert.fail(`unbalanced braces after ${needle}`);
}

// ── The classes (values 5.2; design 6.7; U2's empty box, components/orders/OrderTable.tsx) ──────────────────────────────

test("values 5.2: the empty box is the HTML's empty line - centred, padding 48 0, 14px --text-2 - in U2's 6px column", () => {
  assert.deepEqual(
    sorted(tokens(FLOOR_EMPTY_CLASS)),
    sorted(["flex", "flex-col", "items-center", "gap-1.5", "py-12", "text-center", "text-[14px]", "text-muted-foreground"]),
    "padding 48px 0 (no side padding: values 5.2), centred, 14px, --text-2 (text-muted-foreground); U2's column, 6px apart",
  );
  assert.equal(FLOOR_EMPTY_TITLE_CLASS, "text-[14px] font-semibold text-foreground", "the title where we have one: U2's 14px 600, in --text (design 6.7)");
});

test("design 6.7: Show all tables is U2's 40px outline button (Clear filters), 8px past the column's gap; Open Setup the same in the accent", () => {
  const u2 = tokens(ORDERS_OUTLINE_BUTTON_CLASS).filter((t) => !t.startsWith("disabled:"));
  // The focus ring is the Floor's own (next test): U2's outline button has none, and that page is not edited here.
  const look = tokens(FLOOR_EMPTY_OUTLINE_BUTTON_CLASS).filter((t) => !t.startsWith("focus-visible:"));
  assert.deepEqual(sorted(look), sorted(["mt-2", ...u2]), "U2's outline button exactly (never disabled here), with U2's mt-2");
  assert.ok(tokens(FLOOR_EMPTY_OUTLINE_BUTTON_CLASS).includes("h-10"), "40px (global constraints: as U2's empty-state buttons)");
  const accent = tokens(FLOOR_EMPTY_ACCENT_BUTTON_CLASS);
  const shape = u2.filter((t) => !/^(border-border|bg-card|text-foreground|hover:)/.test(t));
  for (const t of ["mt-2", ...shape]) assert.ok(accent.includes(t), `Open Setup keeps the 40px button's shape: ${t}`);
  for (const t of ["border-primary", "bg-primary", "text-primary-foreground", "hover:bg-primary-hover", "hover:border-primary-hover"]) {
    assert.ok(accent.includes(t), `Open Setup in the accent (the confirm's kind 1, the header's hover; the rule hovers with the fill, no ring): ${t}`);
  }
  for (const t of ["border-border", "bg-card", "text-foreground"]) assert.ok(!accent.includes(t), `Open Setup is not the outline: no ${t}`);
});

test("design 6.5: both empty-state buttons wear the tiles' 2px accent focus ring (today's kit ring, the whole page alike)", () => {
  const ring = tokens(FLOOR_TILE_CLASS).filter((t) => t.startsWith("focus-visible:"));
  assert.deepEqual(sorted(ring), sorted(["focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-primary", "focus-visible:ring-offset-1"]), "landmark: the tile's ring");
  for (const [name, cls] of [["Show all tables", FLOOR_EMPTY_OUTLINE_BUTTON_CLASS], ["Open Setup", FLOOR_EMPTY_ACCENT_BUTTON_CLASS]] as const) {
    for (const t of ring) assert.ok(tokens(cls).includes(t), `${name}: ${t} (not the browser's outline)`);
  }
});

test("design 6.7: a skeleton tile is the new tile's shape - 112px, 100px below 720px, radius 14", () => {
  assert.deepEqual(sorted(tokens(FLOOR_SKELETON_TILE_CLASS)), sorted(["h-[112px]", "max-tab:h-[100px]", "rounded-[14px]"]), "the brief's shape");
  for (const cls of [FLOOR_EMPTY_CLASS, FLOOR_EMPTY_TITLE_CLASS, FLOOR_EMPTY_OUTLINE_BUTTON_CLASS, FLOOR_EMPTY_ACCENT_BUTTON_CLASS, FLOOR_SKELETON_TILE_CLASS]) {
    assert.ok(!/brand-|\b(?:bg|text|border)-(?:red|green|blue|amber|zinc|gray|slate)-\d/.test(cls), `tokens only: ${cls}`);
  }
});

// ── Renders ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test("FloorSkeleton: eight tiles of the new shape in the floor grid, hidden from screen readers", () => {
  const html = renderToStaticMarkup(createElement(FloorSkeleton));
  const grid = tagOf(html, "floor-skeleton");
  expectAll(grid, tokens(FLOOR_GRID_CLASS), "the skeleton grid is the floor grid");
  assert.match(grid, /aria-hidden="true"/, "the loading shape is not read out");
  const tiles = tagsOf(html, "floor-skeleton-tile");
  assert.equal(tiles.length, 8, "eight skeleton tiles");
  for (const tile of tiles) {
    expectAll(tile, [...tokens(FLOOR_SKELETON_TILE_CLASS), "animate-pulse", "bg-muted"], "a skeleton tile (the kit's pulse)");
    for (const old of ["h-28", "rounded-lg", "rounded-md"]) assert.ok(!classesOf(tile).includes(old), `today's ${old} is gone`);
  }
});

/** The element carrying data-ui="<name>" in a React element tree (props only; function components are not called). */
function findByUi(node: ReactNode, name: string): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByUi(child, name);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const props = node.props as Record<string, unknown>;
  if (props["data-ui"] === name) return node as ReactElement<Record<string, unknown>>;
  return findByUi(props.children as ReactNode, name);
}

test("FloorFilterEmpty: the HTML's line, then our Show all tables (no icon, no card); the button calls the reset", () => {
  let resets = 0;
  const onShowAll = () => {
    resets += 1;
  };
  const html = renderToStaticMarkup(createElement(FloorFilterEmpty, { onShowAll }));
  expectAll(tagOf(html, "floor-empty"), tokens(FLOOR_EMPTY_CLASS), "the empty box");
  assert.equal(textOf(html, "floor-empty-text"), FLOOR_EMPTY_FILTER_TEXT, "values 5.2: the HTML's words");
  assert.equal(FLOOR_EMPTY_FILTER_TEXT, "No tables match this filter.", "landmark: the words (design 11)");
  assert.equal(tagsOf(html, "floor-empty-title").length, 0, "no title line: the HTML's one line");
  const button = tagOf(html, "floor-empty-action");
  assert.match(button, /^<button /, "a button");
  assert.match(button, /type="button"/, "never a submit");
  expectAll(button, tokens(FLOOR_EMPTY_OUTLINE_BUTTON_CLASS), "Show all tables");
  assert.equal(textOf(html, "floor-empty-action"), "Show all tables", "our words (kept, design 11)");
  assert.ok(html.indexOf('data-ui="floor-empty-text"') < html.indexOf('data-ui="floor-empty-action"'), "the button under the line");
  assert.ok(!html.includes("<svg"), "no icon (values 5.2)");
  for (const card of ["border-dashed", "rounded-xl", "p-8"]) assert.ok(!html.includes(card), `no kit card: ${card}`);
  const action = findByUi(FloorFilterEmpty({ onShowAll }), "floor-empty-action");
  assert.ok(action && typeof action.props.onClick === "function", "landmark: the button's click handler");
  (action!.props.onClick as () => void)();
  assert.equal(resets, 1, "a press runs the page's reset (the pill and the area, Task 2)");
});

const ADMIN = { user: { role: "admin" }, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session;
const STAFF = { user: { role: "staff" }, expires: "2099-01-01T00:00:00.000Z" } as unknown as Session;
/** FloorEmptyState under a session (undefined = still loading) and a query client, as in the app's providers. */
const renderEmpty = (session: Session | undefined): string => {
  // The children ride as createElement's third argument (react/no-children-prop); the props' type wants them inside.
  const sessionProps = { session } as ComponentProps<typeof SessionProvider>;
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(SessionProvider, sessionProps, createElement(FloorEmptyState))),
  );
};

test("FloorEmptyState, admin: today's words in the HTML's empty style and Open Setup, a 40px accent link to Setup", () => {
  const html = renderEmpty(ADMIN);
  expectAll(tagOf(html, "floor-empty"), tokens(FLOOR_EMPTY_CLASS), "the empty box");
  expectAll(tagOf(html, "floor-empty-title"), tokens(FLOOR_EMPTY_TITLE_CLASS), "the title");
  assert.equal(textOf(html, "floor-empty-title"), "No tables yet", "today's admin title");
  assert.equal(textOf(html, "floor-empty-text"), "Add your tables on the Setup page to see them here.", "today's admin line");
  const link = tagOf(html, "floor-empty-action");
  assert.match(link, /^<a /, "a link");
  assert.ok(link.includes(`href="${TABLES_SETUP_PATH}"`), "to the Setup page");
  expectAll(link, tokens(FLOOR_EMPTY_ACCENT_BUTTON_CLASS), "Open Setup");
  assert.equal(textOf(html, "floor-empty-action"), "Open Setup", "today's word");
  assert.ok(html.indexOf('data-ui="floor-empty-title"') < html.indexOf('data-ui="floor-empty-text"'), "the title over the line");
  assert.ok(html.indexOf('data-ui="floor-empty-text"') < html.indexOf('data-ui="floor-empty-action"'), "the button under it");
  assert.ok(!html.includes("<svg") && !html.includes("border-dashed"), "no icon, no kit card");
});

test("FloorEmptyState, staff: today's words, no button", () => {
  const html = renderEmpty(STAFF);
  assert.equal(textOf(html, "floor-empty-title"), "Floor plan not set up", "today's staff title");
  assert.equal(textOf(html, "floor-empty-text"), "Ask an admin to add tables on the Setup page.", "today's staff line");
  assert.equal(tagsOf(html, "floor-empty-action").length, 0, "staff get no Setup button");
  assert.ok(!html.includes("<a ") && !html.includes("Open Setup"), "no link to Setup");
});

test("FloorEmptyState while the session loads: the skeleton, never the staff words first (today's rule)", () => {
  const html = renderEmpty(undefined);
  assert.equal(tagsOf(html, "floor-skeleton-tile").length, 8, "the eight skeleton tiles");
  assert.equal(tagsOf(html, "floor-empty").length, 0, "no empty box yet");
  assert.ok(!html.includes("Floor plan not set up") && !html.includes("No tables yet"), "no words flip from staff to admin");
});

// ── Source pins ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("the page: skeleton, no tables, filtered empty, sections, flat grid - in today's order, from FloorStates", () => {
  const page = code(PAGE);
  assert.match(page, /import \{ FloorEmptyState, FloorFilterEmpty, FloorSkeleton \} from "@\/components\/tables\/FloorStates";/, "the states' one file");
  const order = [
    "list === undefined ? (",
    "<FloorSkeleton />",
    ") : list.length === 0 ? (",
    "<FloorEmptyState />",
    ") : visible.length === 0 ? (",
    "<FloorFilterEmpty onShowAll={showAllTables} />",
    ") : sections.showHeadings ? (",
    "<FloorAreaSections groups={sections.groups} renderTile={renderTile} />",
    "<div className={FLOOR_GRID_CLASS}>{visible.map(",
  ];
  let last = -1;
  for (const needle of order) {
    const at = page.indexOf(needle, last + 1);
    assert.ok(at > last, `branch order: "${needle}" after the previous one`);
    last = at;
  }
  assert.equal(count(page, "<FloorFilterEmpty "), 1, "one filtered empty, wired to the reset of the pill and the area");
  for (const gone of ["<EmptyState", "LayoutGrid", "SKELETON_TILE_CLASS", "useAuth("]) assert.ok(!page.includes(gone), `the page no longer holds ${gone}`);
  const error = page.slice(page.indexOf("<FloorFrame>"), page.indexOf("</FloorFrame>"));
  for (const kept of ['title="Couldn\'t load the floor"', 'description="Check the internet connection, then try again."', "onRetry={retryAll}", 'retryLabel="Try again"']) {
    assert.ok(error.includes(kept), `the first-load error keeps ${kept} (design 6.7)`);
  }
});

test("FloorStates: the skeleton in the floor grid; the one role read in FloorEmptyState; the filtered empty's reset is its prop", () => {
  const src = code(STATES);
  assert.ok(src.includes("const SKELETON_TILES = 8;"), "eight tiles (today's count)");
  assert.ok(src.includes('<div data-ui="floor-skeleton" className={FLOOR_GRID_CLASS} aria-hidden>'), "in the floor grid");
  const empty = bodyAfter(src, "export function FloorEmptyState()");
  assert.ok(empty.includes("const { isAdmin, isLoading: authLoading } = useAuth();"), "today's role read and its wait");
  assert.ok(empty.includes("if (authLoading) return <FloorSkeleton />;"), "the skeleton while the session loads");
  assert.ok(empty.includes("href={TABLES_SETUP_PATH} prefetch={false}"), "Open Setup goes where it did, unprefetched");
  const filtered = bodyAfter(src, "export function FloorFilterEmpty({ onShowAll }: { onShowAll: () => void })");
  assert.ok(filtered.includes("{FLOOR_EMPTY_FILTER_TEXT}") && filtered.includes("onClick={onShowAll}"), "the HTML's line and our reset");
});

test("design 6.6: Seat now and Free table wear the HTML confirm sheet; words, destructive, busy and the fade latch stay", () => {
  const src = code(DIALOGS);
  assert.equal(count(src, 'look="sheet"'), 1, "FloorDialogs passes look=\"sheet\" once");
  const tag = src.slice(src.indexOf("<ConfirmDialog"), src.indexOf("/>", src.indexOf("<ConfirmDialog")));
  assert.ok(tag.includes('look="sheet"'), "on its one ConfirmDialog");
  for (const kept of ["open={dialog !== null}", "onOpenChange={onOpenChange}", "destructive={copy.destructive}", "isLoading={busy}", "onConfirm={onConfirm}"]) {
    assert.ok(tag.includes(kept), `kept: ${kept}`);
  }
  for (const words of ["title: `Seat guests at ${t}?`", 'confirmLabel: "Seat now"', "destructive: false", "title: `Free ${t}?`", 'confirmLabel: "Free table"', "destructive: true"]) {
    assert.ok(src.includes(words), `today's words and kinds: ${words} (Seat now in the accent, Free table in --bad)`);
  }
  assert.ok(src.includes("if (dialog && dialog !== shown) setShown(dialog);") && src.includes("copyFor(dialog ?? shown)"), "the fade latch stays");
});

test("the brief's check: in the sheet, Escape and Cancel only ask to close; the hook ignores that while the write runs", () => {
  const confirm = code(CONFIRM);
  assert.ok(confirm.includes("function ConfirmSheet({"), "landmark: the sheet look's own function");
  const sheet = bodyAfter(confirm, "}: ConfirmSheetProps)");
  assert.ok(sheet.includes("<AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>"), "controlled: it opens and closes only by the caller's open");
  assert.ok(!/\buseState\b|onEscapeKeyDown|onInteractOutside/.test(sheet), "no state of its own and no Escape handler that closes it");
  const cancel = sheet.slice(sheet.indexOf("<AlertDialogPrimitive.Cancel"), sheet.indexOf("</AlertDialogPrimitive.Cancel>"));
  assert.ok(cancel.includes("disabled={isLoading}") && !cancel.includes("onClick"), "Cancel is Radix's own close (onOpenChange(false)), off while busy");
  const hook = code(ACTIONS_HOOK);
  assert.ok(bodyAfter(hook, "const onDialogOpenChange = (open: boolean) =>").includes("if (!open && !confirmingRef.current) setDialog(null);"), "a close while confirming is ignored");
  const run = bodyAfter(hook, "const confirm = async () =>");
  const at = (needle: string): number => {
    const i = run.indexOf(needle);
    assert.ok(i >= 0, `landmark: ${needle} in confirm`);
    return i;
  };
  const [on, check, fin, off] = [at("confirmingRef.current = true;"), at("await cleared(table)"), at("finally"), at("confirmingRef.current = false;")];
  assert.ok(on < check, "confirming from before the open-bill check");
  assert.ok(off > fin, "until the write ends");
});
