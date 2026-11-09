// Settings hub in the new UI (docs/superpowers/plans/2026-11-09-settings-hub-ui.md): the sections in groups (Your cafe,
// Printing, Diners), each group an h2 over one card of link rows, every class ON its own element, heading levels, and
// the WebView / brand bans. The grouping itself: lib/settings-sections.test.ts; every visible section reachable:
// lib/settings-shell-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import * as L from "./settings-card-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string): string => stripComments(raw(rel));
const countOf = (src: string, needle: string): number => src.split(needle).length - 1;

const PAGE = "app/(dashboard)/settings/page.tsx";

test("hub constants: the plan's values", () => {
  assert.equal(L.SETTINGS_HUB_STACK_CLASS, "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6", "the groups, 24px apart");
  assert.equal(L.SETTINGS_HUB_GROUP_CLASS, "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2", "a group: its title over its card");
  assert.equal(L.SETTINGS_HUB_GROUP_TITLE_CLASS, "px-1 text-[13.5px] font-semibold text-muted-foreground", "the group title");
  assert.equal(L.SETTINGS_HUB_LIST_CLASS, "min-w-0 overflow-clip rounded-[12px] border border-border bg-card", "the group's card");
  assert.equal(L.SETTINGS_HUB_ITEM_CLASS, "border-t border-border-2 first:border-t-0", "a rule between rows");
  assert.equal(
    L.SETTINGS_HUB_ROW_CLASS,
    "flex min-h-16 items-center gap-3 px-4 py-3 text-foreground transition-colors pointer-fine:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
    "the row is the link, 64px at least; the ring sits inside it because the card clips",
  );
  assert.equal(
    L.SETTINGS_HUB_ICON_CLASS,
    "grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-status-info-tint text-primary",
    "the icon tile",
  );
  assert.equal(L.SETTINGS_HUB_ROW_TITLE_CLASS, "text-[14.5px] font-semibold leading-snug", "the row title");
  assert.equal(L.SETTINGS_HUB_ROW_SUB_CLASS, "text-[13px] text-muted-foreground text-pretty", "the row line");
  assert.equal(L.SETTINGS_HUB_CHEVRON_CLASS, "h-4 w-4 shrink-0 text-muted-foreground", "the chevron");
});

test("page: the narrow shell and header, one stack of groups, each an h2 over a list card of link rows", () => {
  const p = read(PAGE);
  assert.ok(p.includes('<div className="mx-auto w-full max-w-3xl space-y-6 pb-10">'), "the narrow shell, as the section pages");
  assert.match(
    p,
    /<PageHeader\s+eyebrow="Admin"\s+title="Settings"\s+description="Everything about how this POS works, prints and looks\."\s*\/>/,
    "the header words are unchanged",
  );
  assert.match(
    p,
    /<div className=\{SETTINGS_HUB_STACK_CLASS\}>\s*\{settingsHubGroups\(VISIBLE_SETTINGS_SECTIONS\)\.map\(\(group\) => \(\s*<section\s+key=\{group\.key\}\s+aria-labelledby=\{`settings-group-\$\{group\.key\}`\}\s+className=\{SETTINGS_HUB_GROUP_CLASS\}\s*>\s*<h2 id=\{`settings-group-\$\{group\.key\}`\} className=\{SETTINGS_HUB_GROUP_TITLE_CLASS\}>\s*\{group\.title\}\s*<\/h2>\s*<ul className=\{SETTINGS_HUB_LIST_CLASS\}>\s*\{group\.sections\.map\(\(section\) => \{/,
    "a group: a section named by its h2, then the list card",
  );
  assert.match(
    p,
    /<li key=\{section\.slug\} className=\{SETTINGS_HUB_ITEM_CLASS\}>\s*<AppLink href=\{settingsSectionPath\(section\.slug\)\} className=\{SETTINGS_HUB_ROW_CLASS\}>\s*<span className=\{SETTINGS_HUB_ICON_CLASS\}>\s*<Icon className="h-\[18px\] w-\[18px\]" aria-hidden="true" \/>\s*<\/span>\s*<span className="grid min-w-0 flex-1 gap-0\.5">\s*<span className=\{SETTINGS_HUB_ROW_TITLE_CLASS\}>\{section\.title\}<\/span>\s*<span className=\{SETTINGS_HUB_ROW_SUB_CLASS\}>\{section\.description\}<\/span>\s*<\/span>\s*<ChevronRight className=\{SETTINGS_HUB_CHEVRON_CLASS\} aria-hidden="true" \/>\s*<\/AppLink>\s*<\/li>/,
    "a row: the whole row is the link; icon, title, line, chevron",
  );
  for (const name of [
    "SETTINGS_HUB_STACK_CLASS",
    "SETTINGS_HUB_GROUP_CLASS",
    "SETTINGS_HUB_GROUP_TITLE_CLASS",
    "SETTINGS_HUB_LIST_CLASS",
    "SETTINGS_HUB_ITEM_CLASS",
    "SETTINGS_HUB_ROW_CLASS",
    "SETTINGS_HUB_ICON_CLASS",
    "SETTINGS_HUB_ROW_TITLE_CLASS",
    "SETTINGS_HUB_ROW_SUB_CLASS",
    "SETTINGS_HUB_CHEVRON_CLASS",
  ]) {
    assert.equal(countOf(p, `className={${name}}`), 1, `${name} sits on exactly one element`);
  }
});

test("headings: the shell's header holds the h1; each group title is an h2 and nothing else is a heading", () => {
  const p = read(PAGE);
  assert.equal(countOf(p, "<h2"), 1, "one h2, rendered per group");
  assert.ok(!/<h[13-6]\b/.test(p), "no h1 (the shell's header), no h3 or lower");
  assert.ok(!/<p\b/.test(p), "the row title and line are spans inside the link, never a <p>");
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, /NN colour opacity, old card look", () => {
  const s = raw(PAGE);
  assert.ok(s.length > 0 && s.includes("export default function SettingsPage"), "landmark: the page read raw, comments included");
  assert.ok(!s.includes("color-mix"), "no color-mix()");
  assert.ok(!s.includes("light-dark("), "no light-dark()");
  assert.ok(!s.includes("backdrop-blur"), "no backdrop-blur");
  assert.ok(!s.includes("overflow-" + "hidden"), "overflow-clip, never the hidden one");
  assert.ok(!s.includes("brand-"), "no brand-* class");
  assert.ok(!/\bBRAND_/.test(s), "no BRAND_* class constant");
  assert.ok(!/\bCARD_CLASS\b|\bICON_TILE_CLASS\b/.test(s), "the old tile constants are gone");
  const opacity = s.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/);
  assert.equal(opacity, null, `no /NN opacity modifier on a colour (found ${opacity?.[0]})`);
});
