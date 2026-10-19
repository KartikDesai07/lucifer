// U0 Task 2, fix round 1: the nav's behaviours a restyle could silently drop — the lit row scrolled into view in
// either form, the collapse choice remembered on the device before the first paint, and a row with sub-pages that is
// a plain disclosure in the wide form and a popup trigger only in the rail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { litNavRow } from "@/lib/nav-lit-row";
import { NAV_COLLAPSED_ATTR, NAV_STATE_COOKIE, NAV_STATE_SCRIPT } from "@/lib/nav-state-script";
import { stripComments } from "@/lib/source-pin-utils";
import { NavGroupRow } from "@/components/layout/nav-parts";
import { NavSettings } from "@/components/layout/nav-icons";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

// ── the lit row in view ──────────────────────────────────────────────────────

interface FakeRow {
  name: string;
  rendered: boolean;
  getClientRects(): { length: number };
}
const row = (name: string, rendered: boolean): FakeRow => ({ name, rendered, getClientRects: () => ({ length: rendered ? 1 : 0 }) });
const navWith = (byQuery: Record<string, FakeRow[]>) => ({
  querySelectorAll: (selector: string): FakeRow[] => byQuery[selector] ?? [],
});

test("litNavRow: the current page's row when it is rendered (a flat row, a wide sub-row, the Settings hub)", () => {
  const nav = navWith({ '[aria-current="page"]': [row("Payments sub-row", true)], '[data-active="true"]': [row("Reports row", true)] });
  assert.equal(litNavRow(nav)?.name, "Payments sub-row", "the wide form scrolls to the lit sub-row itself");
});

test("litNavRow: in the rail the current sub-row is not rendered, so the lit group row is the one to scroll to", () => {
  const nav = navWith({ '[aria-current="page"]': [row("Payments sub-row (hidden)", false)], '[data-active="true"]': [row("Reports row", true)] });
  assert.equal(litNavRow(nav)?.name, "Reports row", "the rail scrolls to the lit Reports row, not to a hidden sub-row");
});

test("litNavRow: the first rendered match wins, and nothing lit means nothing to scroll", () => {
  const nav = navWith({ '[aria-current="page"]': [row("hidden", false), row("shown", true)] });
  assert.equal(litNavRow(nav)?.name, "shown", "a rendered match after a hidden one");
  assert.equal(litNavRow(navWith({})), undefined, "no lit row: no target");
});

test("PIN: AppSidebar's scroll-into-view effect scrolls litNavRow's pick, never the first aria-current blindly", () => {
  const app = read("components/layout/AppSidebar.tsx");
  assert.match(app, /litNavRow\(navRef\.current\)\?\.scrollIntoView\(\{ block: "nearest" \}\)/, "the effect scrolls the rendered lit row");
  assert.ok(!app.includes(`querySelector('[aria-current="page"]')`), "the old first-match query is gone");
});

// ── the remembered collapse ──────────────────────────────────────────────────

function runScript(cookie: string): boolean {
  let marked = false;
  const document = {
    cookie,
    documentElement: {
      setAttribute: (name: string) => {
        if (name === NAV_COLLAPSED_ATTR) marked = true;
      },
    },
  };
  new Function("document", NAV_STATE_SCRIPT)(document);
  return marked;
}

test("NAV_STATE_SCRIPT marks <html> collapsed only when the sidebar cookie says false", () => {
  assert.equal(NAV_STATE_COOKIE, "sidebar_state", "the primitive's existing cookie");
  assert.equal(runScript("sidebar_state=false"), true, "the cookie alone");
  assert.equal(runScript("a=1; sidebar_state=false; b=2"), true, "among other cookies");
  assert.equal(runScript("sidebar_state=true"), false, "expanded: not marked");
  assert.equal(runScript(""), false, "no cookie: the wide sidebar");
  assert.equal(runScript("xsidebar_state=false"), false, "another cookie's name is not ours");
  assert.equal(runScript("sidebar_state=falsey"), false, "only the exact value");
  assert.doesNotThrow(() => new Function("document", NAV_STATE_SCRIPT)({}), "a missing cookie API never throws");
});

test("PIN: the layout runs NAV_STATE_SCRIPT before the shell paints, and the provider mirrors and reads the attribute", () => {
  const layout = read("app/(dashboard)/layout.tsx");
  assert.match(layout, /import \{ NAV_STATE_SCRIPT \} from "@\/lib\/nav-state-script";/, "the layout imports the script");
  const script = layout.indexOf("<script>{NAV_STATE_SCRIPT}</script>");
  assert.ok(script >= 0, "the layout renders <script>{NAV_STATE_SCRIPT}</script>");
  assert.ok(script < layout.indexOf("<SidebarProvider>"), "before <SidebarProvider>, so it runs before the nav paints");
  assert.ok(!/\bimport\b/.test(read("lib/nav-state-script.ts")), "the script module imports nothing (the server layout reads it)");

  const sidebar = read("components/ui/sidebar.tsx");
  assert.match(sidebar, /const SIDEBAR_COOKIE_NAME = NAV_STATE_COOKIE;/, "the provider writes the cookie the script reads");
  assert.match(
    sidebar,
    /document\.documentElement\.toggleAttribute\(NAV_COLLAPSED_ATTR, !openState\);/,
    "a toggle mirrors the choice on <html> for the wide variant",
  );
  assert.match(
    sidebar,
    /document\.documentElement\.hasAttribute\(NAV_COLLAPSED_ATTR\)\) _setOpen\(false\);/,
    "the provider takes the remembered choice once mounted",
  );
  const css = readFileSync(path.join(CAFE_ROOT, "app/globals.css"), "utf8");
  assert.ok(css.includes(`:not([${NAV_COLLAPSED_ATTR}])`), "the wide variant reads the same attribute");
});

// ── a row with sub-pages: a disclosure when wide, a popup trigger in the rail ─

const groupRow = (wide: boolean): string =>
  renderToStaticMarkup(
    createElement(NavGroupRow, {
      title: "Settings",
      icon: NavSettings,
      isActive: false,
      wide,
      open: true,
      onOpenChange: () => {},
      subRows: () => null,
    }),
  );

test("NavGroupRow: the wide form is a plain disclosure (aria-expanded from the sub-rows, no popup role)", () => {
  const html = groupRow(true);
  const button = html.match(/<button[^>]*>/)?.[0] ?? "";
  assert.ok(button.includes('data-ui="nav-item"'), "landmark: the row button was read");
  assert.ok(!button.includes("aria-haspopup"), "no aria-haspopup in the wide form");
  assert.ok(button.includes('aria-expanded="true"'), "aria-expanded follows the open sub-rows");
});

test("NavGroupRow: in the rail the row is the flyout's trigger (aria-haspopup, aria-expanded from the flyout)", () => {
  const html = groupRow(false);
  const button = html.match(/<button[^>]*>/)?.[0] ?? "";
  assert.ok(button.includes('data-ui="nav-item"'), "landmark: the row button was read");
  assert.ok(button.includes('aria-haspopup="dialog"'), "the rail row announces its flyout");
  assert.ok(button.includes('aria-expanded="false"'), "aria-expanded follows the (closed) flyout, not the sub-rows");
});
