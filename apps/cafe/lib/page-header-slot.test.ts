// U0 Task 3 (values 2.5, design 5.3): every page's title, subtitle and actions live in the shell's 56px header. The
// header shows pageTitleFor(pathname) at once (so the title never flashes), a page's PageHeader then fills in its
// subtitle and puts its actions in the header from 720px up, or once in a row at the top of the page body on a phone.
// A back-link eyebrow (Settings sections, Festival cards, Expense categories) becomes a 36px button before the title.
// Fix round 1 (ruling R6): the actions sit in the header only beside a title of at least 140px (measured), else in the
// body row; wherever they are, they take the HTML's 36px header-button look.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Link from "next/link";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { FESTIVAL_CARDS_TITLE } from "@pos/shared/reward-campaigns";
import { defaultPageSubtitle, headerWordsFor, pageTitleFor } from "@/lib/page-titles";
import { settingsSectionBySlug, type SettingsSectionSlug } from "@/lib/settings-sections";
import { stripComments } from "@/lib/source-pin-utils";
import { classesOf, tagOf } from "./class-tags.fixtures";
import {
  HEADER_TITLE_MIN_PX,
  PageHeaderBackLink,
  PageHeaderSlotContext,
  actionsFitBesideTitle,
  backLinkOf,
  type PageHeaderSlot,
} from "@/components/layout/page-header-slot";
import { HeaderTitle } from "@/components/layout/HeaderTitle";
import { PageHeader } from "@/components/shared/PageHeader";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import { ExpenseCategoriesManager } from "@/components/expenses/ExpenseCategoriesManager";
import FestivalCardsPage from "@/app/(dashboard)/customers/festival-cards/page";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DASHBOARD_DIR = path.join(CAFE_ROOT, "app/(dashboard)");
const read = (abs: string): string => stripComments(readFileSync(abs, "utf8"));
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

// ── pageTitleFor: the title the header shows before the page's own PageHeader mounts ──────────────────────────────────

function dashboardRoutes(): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name === "page.tsx") {
        const rel = path.relative(DASHBOARD_DIR, dir).split(path.sep).join("/");
        out.push({ route: rel === "" ? "/" : `/${rel}`, file: abs });
      }
    }
  };
  walk(DASHBOARD_DIR);
  return out.sort((a, b) => a.route.localeCompare(b.route));
}

const TITLE_CONSTANTS: Record<string, string> = { FESTIVAL_CARDS_TITLE };

/** The title a source file gives its page: the last PageHeader / ReportHeader's title, a settings section's title, or
 *  a hand-written <h1> (none left since the Dashboard's moved to its PageHeader in Task 5). */
function titleIn(src: string): string | undefined {
  const at = Math.max(src.lastIndexOf("<PageHeader"), src.lastIndexOf("<ReportHeader"));
  if (at >= 0) {
    const m = /\btitle=(?:"([^"]+)"|\{([A-Z_]+)\})/.exec(src.slice(at, at + 600));
    if (m) return m[1] ?? TITLE_CONSTANTS[m[2]];
  }
  const slug = /<SettingsSectionPage\b[^>]*\bslug="([^"]+)"/.exec(src)?.[1];
  if (slug) return settingsSectionBySlug(slug as SettingsSectionSlug).title;
  return /<h1\b[^>]*>([^<{]+)<\/h1>/.exec(src)?.[1]?.trim();
}

/** The page's own title, or the one of the component it renders its header through (ExpensesView, PosHeader, …). */
function titleOfPage(file: string): string | undefined {
  const src = read(file);
  const own = titleIn(src);
  if (own) return own;
  for (const m of src.matchAll(/import \{ (\w+) \} from "@\/components\/([\w/-]+)";/g)) {
    if (!new RegExp(`<${m[1]}\\b`).test(src)) continue;
    const found = titleIn(read(path.join(CAFE_ROOT, `components/${m[2]}.tsx`)));
    if (found) return found;
  }
  return undefined;
}

test("pageTitleFor: every route in app/(dashboard) gets the title its page's header gives it", () => {
  const routes = dashboardRoutes();
  assert.ok(routes.length >= 30, `landmark: the dashboard's pages were found (${routes.length})`);
  for (const { route, file } of routes) {
    const expected = titleOfPage(file);
    assert.ok(expected, `${route}: its title was found in its source (${path.relative(CAFE_ROOT, file)})`);
    assert.equal(pageTitleFor(route), expected, `${route}: pageTitleFor must equal the page's own title`);
  }
});

test("pageTitleFor: a sub-path takes its page's title; an unknown path has none", () => {
  assert.equal(pageTitleFor("/orders/"), "Orders", "a trailing slash is the same page");
  assert.equal(pageTitleFor("/settings/nope"), "Settings", "an unknown section falls back to its parent page");
  assert.equal(pageTitleFor("/nope"), "", "an unknown page has no title");
});

test("defaultPageSubtitle: the HTML's '{cafe} · {weekday, day month}' in the cafe's timezone", () => {
  assert.equal(defaultPageSubtitle("Baseline Cafe", new Date("2026-10-19T06:50:00Z")), "Baseline Cafe · Monday, 19 October", "noon IST");
  assert.equal(defaultPageSubtitle("Baseline Cafe", new Date("2026-10-19T19:00:00Z")), "Baseline Cafe · Tuesday, 20 October", "00:30 IST is already the next day");
});

// ── PageHeader: the page side of the slot ────────────────────────────────────────────────────────────────────────────

const HEADER_STUB = "data-stub-header";
const slot = (actionsInHeader: boolean): PageHeaderSlot => ({
  actionsInHeader,
  renderInHeader: (actions: ReactNode) => createElement("div", { [HEADER_STUB]: "" }, actions),
  register: () => () => undefined,
  bodyRowRef: () => undefined,
});
const renderWith = (actionsInHeader: boolean, props: React.ComponentProps<typeof PageHeader>): string =>
  renderToStaticMarkup(createElement(PageHeaderSlotContext.Provider, { value: slot(actionsInHeader) }, createElement(PageHeader, props)));
const ACTIONS = createElement("button", { type: "button" }, "Today");
const PROPS = { eyebrow: "Service", title: "Orders", description: "View, filter and manage orders.", actions: ACTIONS };

test("PageHeader when its actions fit the header: nothing in the page body, the actions once, in the header", () => {
  const html = renderWith(true, PROPS);
  assert.equal(count(html, ">Today</button>"), 1, "the actions render exactly once");
  assert.ok(html.startsWith(`<div ${HEADER_STUB}="">`) && html.endsWith("</div>"), `everything it renders is inside the header: ${html}`);
  for (const gone of ["Orders", "View, filter", "Service", "<h1", "<h2"]) {
    assert.ok(!html.includes(gone), `the page body no longer shows ${gone}: ${html}`);
  }
});

test("PageHeader on a phone, or when its actions do not fit beside the title: once, in the body row, with the header-button look", () => {
  const html = renderWith(false, { ...PROPS, className: "print:hidden" });
  assert.equal(count(html, ">Today</button>"), 1, "the actions render exactly once");
  assert.ok(!html.includes(HEADER_STUB), "nothing goes to the header");
  const row = /^<div ([^>]*)>/.exec(html)?.[1] ?? "";
  assert.match(row, /data-ui="page-actions"/, "the body row");
  assert.match(row, /data-header-actions=""/, "the row takes the header buttons' look (ruling R6)");
  assert.match(row, /class="[^"]*\bprint:hidden\b[^"]*"/, "the body row carries the page's className");
  for (const gone of ["Orders", "View, filter", "<h1", "<h2"]) {
    assert.ok(!html.includes(gone), `the page body no longer shows ${gone}: ${html}`);
  }
});

// Ruling R13 (U0 match Task 6 fix 1): `phoneActions` stay in the header at every width (the HTML's phone header holds
// the dashboard's End of day icon); from 720px, with room, the actions follow them there; otherwise the actions go to
// the body row and the phoneActions never move.
test("PageHeader phoneActions: always in the header, first; the actions after them in the header, or alone in the body row", () => {
  const phone = createElement("button", { type: "button" }, "Print");
  const wide = renderWith(true, { ...PROPS, phoneActions: phone });
  assert.equal(count(wide, ">Print</button>"), 1, "the phoneActions render exactly once");
  assert.equal(count(wide, ">Today</button>"), 1, "the actions render exactly once");
  assert.ok(wide.startsWith(`<div ${HEADER_STUB}="">`) && wide.endsWith("</div>"), `both in the header: ${wide}`);
  assert.ok(wide.indexOf(">Print</button>") < wide.indexOf(">Today</button>"), "the phoneActions first");
  const narrow = renderWith(false, { ...PROPS, phoneActions: phone, className: "gap-2.5" });
  assert.match(narrow, new RegExp(`^<div ${HEADER_STUB}=""><button type="button">Print</button></div>`), `the phoneActions stay in the header: ${narrow}`);
  const row = narrow.slice(narrow.indexOf("</div>") + "</div>".length);
  assert.match(row, /^<div [^>]*data-ui="page-actions"[^>]*><button type="button">Today<\/button><\/div>$/, `the actions alone in the body row: ${row}`);
  const alone = renderWith(false, { title: "Dashboard", phoneActions: phone });
  assert.ok(!alone.includes('data-ui="page-actions"') && alone.includes(">Print</button>"), "phoneActions alone: no body row");
});

test("PageHeader without actions renders nothing either way (it only names the page)", () => {
  for (const inHeader of [true, false]) {
    assert.equal(renderWith(inHeader, { title: "Settings", eyebrow: "Admin" }), "", `inHeader=${inHeader}: nothing rendered`);
    assert.equal(renderWith(inHeader, { title: "Items", actions: false }), "", `inHeader=${inHeader}: a false actions (isAdmin && …) renders nothing`);
  }
});

// Ruling R6: the actions sit in the header only beside a readable title (at least 140px); otherwise in the body row.
test("actionsFitBesideTitle: in the header while the title keeps 140px; moved up from the body only if it still would", () => {
  assert.equal(HEADER_TITLE_MIN_PX, 140, "the readable title's floor (ruling R6)");
  assert.equal(actionsFitBesideTitle({ actionsInHeader: true, titleWidth: 140, actionsWidth: 0 }), true, "140px left: stays");
  assert.equal(actionsFitBesideTitle({ actionsInHeader: true, titleWidth: 139.5, actionsWidth: 0 }), false, "less: goes to the body");
  // In the body row the title block holds the actions' width too: it keeps what is left after them and one 10px gap.
  assert.equal(actionsFitBesideTitle({ actionsInHeader: false, titleWidth: 400, actionsWidth: 250 }), true, "400 - 250 - 10 = 140: moves up");
  assert.equal(actionsFitBesideTitle({ actionsInHeader: false, titleWidth: 400, actionsWidth: 251 }), false, "139 left: stays in the body");
  // The two checks agree at the boundary, so the actions never flap between the header and the body.
  for (const total of [380, 399, 400, 401, 600]) {
    const actions = 250;
    const up = actionsFitBesideTitle({ actionsInHeader: false, titleWidth: total, actionsWidth: actions });
    const stays = actionsFitBesideTitle({ actionsInHeader: true, titleWidth: total - actions - 10, actionsWidth: 0 });
    assert.equal(up, stays, `title block ${total}px: moving up and staying up agree`);
  }
});

// Final review I1: the rule reads the actions' width in the body row and predicts the title's width in the header, so
// the two placements must lay the actions out the same gap apart; with 8px in the body row and 10px in the header's
// box, two actions flipped every frame in a 2px viewport window (and remounted, closing an open dialog or menu).
/** Tailwind's gap token on an element ("gap-2.5" = 10px, "gap-[10px]" = 10px); exactly one. */
function gapPx(tokens: string[], label: string): number {
  const gaps = tokens.filter((t) => /^gap-(?:\d+(?:\.\d+)?|\[\d+px\])$/.test(t));
  assert.equal(gaps.length, 1, `${label}: one gap token (got ${gaps.join(", ") || "none"})`);
  const scale = /^gap-(\d+(?:\.\d+)?)$/.exec(gaps[0]);
  return scale ? Number(scale[1]) * 4 : Number(/\[(\d+)px\]/.exec(gaps[0])![1]);
}

/** The header's free widths (what the title block takes with the actions box empty) at which the rule flips for ever:
 *  from the body row it moves the actions up (their row there: Σw + bodyGap·(n−1)), and in the header the title block
 *  then measures too narrow (the box: Σw + boxGap·(n−1), one headerGap after the title), so they go back down. */
function flipWindow(m: { widths: number[]; bodyGap: number; boxGap: number; headerGap: number }): number[] {
  const row = (gap: number) => m.widths.reduce((a, b) => a + b, 0) + gap * (m.widths.length - 1);
  const flips: number[] = [];
  for (let free = 0; free <= 1600; free += 0.5) {
    const up = actionsFitBesideTitle({ actionsInHeader: false, titleWidth: free, actionsWidth: row(m.bodyGap) });
    const stays = actionsFitBesideTitle({ actionsInHeader: true, titleWidth: free - row(m.boxGap) - m.headerGap, actionsWidth: 0 });
    if (up && !stays) flips.push(free);
  }
  return flips;
}

test("actionsFitBesideTitle never flips: the body row lays the actions out with the header box's gap (final review I1)", () => {
  // The model has teeth: the gaps as they were (8px in the body row, 10px in the header) flip in a 2(n-1)px window.
  for (const widths of [[120, 90], [120, 90, 64]]) {
    const old = flipWindow({ widths, bodyGap: 8, boxGap: 10, headerGap: 10 });
    assert.equal(old.length, 2 * (widths.length - 1) * 2, `${widths.length} actions, 8px vs 10px: a ${2 * (widths.length - 1)}px window (${old[0]}-${old.at(-1)})`);
  }
  // The real gaps: the header's own (title to the actions box), the box's, and the body row PageHeader renders.
  const headerSrc = read(path.join(CAFE_ROOT, "components/layout/Header.tsx"));
  const headerTokens = /<header className="([^"]*)"/.exec(headerSrc)?.[1].split(/\s+/) ?? [];
  const boxTokens = /<div ref=\{actionsRef\}[^>]*className="([^"]*)"/.exec(headerSrc)?.[1].split(/\s+/) ?? [];
  const bodyTokens = classesOf(tagOf(renderWith(false, PROPS), "page-actions"));
  const gaps = { headerGap: gapPx(headerTokens, "the header"), boxGap: gapPx(boxTokens, "the header's actions box"), bodyGap: gapPx(bodyTokens, "the body row") };
  assert.equal(gaps.headerGap, 10, "landmark: the header's 10px gap (values 2.5)");
  assert.equal(gaps.bodyGap, gaps.boxGap, `the body row and the header's box lay the actions out the same gap apart (body ${gaps.bodyGap}px, header ${gaps.boxGap}px)`);
  for (const widths of [[120], [120, 90], [120, 90, 64], [36, 36, 36, 36], [131.5, 97.25]]) {
    const flips = flipWindow({ widths, ...gaps });
    assert.deepEqual(flips, [], `${widths.length} actions (${widths.join(", ")}): no width flips them (got ${flips[0]}-${flips.at(-1)})`);
  }
});

test("the body row's gap is a default the page's className still overrides (the dashboard's own gap-2.5, any other)", () => {
  const dashboard = classesOf(tagOf(renderWith(false, { title: "Dashboard", actions: ACTIONS, className: "gap-2.5" }), "page-actions"));
  assert.equal(dashboard.filter((t) => t.startsWith("gap-")).join(" "), "gap-2.5", `the dashboard's row: its gap-2.5, once (got "${dashboard.join(" ")}")`);
  const other = classesOf(tagOf(renderWith(false, { ...PROPS, className: "gap-4 print:hidden" }), "page-actions"));
  assert.ok(other.includes("gap-4") && !other.includes("gap-2.5") && other.includes("print:hidden"), `a page's own gap replaces the default (got "${other.join(" ")}")`);
});

test("PIN: the provider decides once for the shell — the 720px media query and the measured room — with a ResizeObserver", () => {
  const src = read(path.join(CAFE_ROOT, "components/layout/page-header-slot.tsx"));
  assert.match(src, /const actionsInHeader = wide && room;/, "in the header only from 720px and only with room");
  assert.match(src, /new ResizeObserver\(measure\)/, "re-measured as the header or the body row resizes");
  assert.match(src, /setRoom\(\s*actionsFitBesideTitle\(/, "the rule above decides");
  const page = read(path.join(CAFE_ROOT, "components/shared/PageHeader.tsx"));
  // Ruling R13 (Task 6 fix 1): the header's one portal carries the phoneActions and, from 720px with room, the actions;
  // the body row carries the actions otherwise.
  assert.match(page, /slot\.renderInHeader\(<>\{phoneActions\}\{inHeader \? actions : null\}<\/>\)/, "the actions in the header only when they fit");
  assert.match(page, /const bodyActions = slot \? \(inHeader \? null : actions\)/, "and in the body row only when they do not: one place or the other, never both");
  assert.match(page, /ref=\{slot\?\.bodyRowRef\}/, "the body row is measured too");
});

// ── back links ───────────────────────────────────────────────────────────────────────────────────────────────────────

test("a back-link eyebrow becomes the header's 36px back button, keeping its href", () => {
  const eyebrow = createElement(Link, { href: "/settings", prefetch: false }, createElement("svg", { "aria-hidden": true }), "\n  Settings\n");
  const back = backLinkOf(eyebrow);
  assert.deepEqual(back, { href: "/settings", label: "Settings" }, "the href and the link's words are read off the element");
  assert.equal(backLinkOf("Service"), undefined, "a string eyebrow is not a back link");
  assert.equal(backLinkOf(undefined), undefined, "no eyebrow, no back link");
  const html = renderToStaticMarkup(createElement(PageHeaderBackLink, { back: back! }));
  assert.match(html, /^<a [^>]*href="\/settings"/, `a link to the same place: ${html}`);
  assert.match(html, /aria-label="Back to Settings"/, "named for a screen reader");
  assert.match(html, /data-ui="header-back"/, "probe hook");
  const tokens = /class="([^"]*)"/.exec(html)?.[1].split(/\s+/) ?? [];
  for (const token of ["h-9", "w-9", "rounded-md", "border", "border-border", "bg-card"]) {
    assert.ok(tokens.includes(token), `the back button is the HTML's 36px outline square: ${token}`);
  }
});

/** The eyebrow a page hands its PageHeader, found in the element tree it returns (nothing is rendered). */
function eyebrowIn(node: ReactNode): ReactNode | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = eyebrowIn(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isValidElement<{ eyebrow?: ReactNode; children?: ReactNode }>(node)) return undefined;
  if (node.type === PageHeader) return node.props.eyebrow;
  return eyebrowIn(node.props.children);
}

test("the three real back-link pages give the header a back link (backLinkOf reads their actual eyebrows)", () => {
  const settings = eyebrowIn(SettingsPageHeader({ title: "Business details", description: "x" }));
  assert.deepEqual(backLinkOf(settings), { href: "/settings", label: "Settings" }, "a Settings section goes back to Settings");
  const festival = eyebrowIn(FestivalCardsPage());
  assert.deepEqual(backLinkOf(festival), { href: "/customers", label: "Customers" }, "Festival cards goes back to Customers");
  // The manager uses hooks, so it is called inside a component of our own (its hooks run there) and its tree kept.
  let tree: ReactNode = null;
  function Capture() {
    tree = ExpenseCategoriesManager();
    return null;
  }
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Capture)));
  assert.deepEqual(backLinkOf(eyebrowIn(tree)), { href: "/expenses", label: "Expenses" }, "Expense categories goes back to Expenses");
});

// ── the shell side: the header shows what the page registers ─────────────────────────────────────────────────────────

const MON_NOON = new Date("2026-10-19T06:50:00Z");

test("headerWordsFor: the route's title and the cafe line until a page registers; then the page's own words", () => {
  assert.deepEqual(
    headerWordsFor({ info: null, pathname: "/orders", cafeName: "Baseline Cafe", now: MON_NOON }),
    { title: "Orders", subtitle: "Baseline Cafe · Monday, 19 October" },
    "before the page's PageHeader mounts",
  );
  assert.deepEqual(
    headerWordsFor({ info: { title: "Orders", description: "View, filter and manage orders." }, pathname: "/orders", cafeName: "Baseline Cafe", now: MON_NOON }),
    { title: "Orders", subtitle: "View, filter and manage orders." },
    "the page's description is the second line",
  );
  assert.deepEqual(
    headerWordsFor({ info: { title: "POS Terminal" }, pathname: "/pos", cafeName: "Baseline Cafe", now: MON_NOON }),
    { title: "POS Terminal", subtitle: "Baseline Cafe · Monday, 19 October" },
    "no description: the HTML's cafe line",
  );
});

test("HeaderTitle draws the registered words: the h1, the subtitle, the section for screen readers, and the back link", () => {
  const html = renderToStaticMarkup(
    createElement(HeaderTitle, {
      title: "Business details",
      subtitle: "Name, logo, contact details",
      eyebrow: undefined,
      back: { href: "/settings", label: "Settings" },
      titleRef: () => undefined,
    }),
  );
  const link = /^<a ([^>]*)>/.exec(html)?.[1] ?? "";
  assert.ok(link.includes('href="/settings"') && link.includes('aria-label="Back to Settings"'), `the back link comes first, before the title: ${html}`);
  assert.match(html, /<div data-ui="header-title-block" class="min-w-0 flex-1">/, "the HTML's flex:1 + min-width:0 title block");
  assert.match(html, /<h1 data-ui="header-title" class="[^"]*">Business details<\/h1>/, "the title is the page's h1");
  assert.match(html, /<p data-ui="header-subtitle" class="[^"]*">Name, logo, contact details<\/p>/, "the second line");
  const plain = renderToStaticMarkup(
    createElement(HeaderTitle, { title: "Orders", subtitle: "x", eyebrow: "Service", back: undefined, titleRef: () => undefined }),
  );
  assert.ok(!plain.includes("<a "), "no back link without one");
  assert.match(plain, /<span class="sr-only">Service: <\/span><h1/, "a section eyebrow is read before the title, not shown");
});

test("PIN: the header composes the registered words, the actions box (min-w-0, the header-button look) and the slot's refs", () => {
  const header = read(path.join(CAFE_ROOT, "components/layout/Header.tsx"));
  assert.match(header, /headerWordsFor\(\{ info, pathname, cafeName: name, now: new Date\(\) \}\)/, "the words come from the rule tested above");
  assert.match(header, /<HeaderTitle\b[^>]*titleRef=\{titleRef\}/, "the title block is measured");
  assert.ok(!header.includes('className="sr-only">{name}</h1>'), "the old screen-reader-only cafe h1 is gone");
  const box = /<div ref=\{actionsRef\}([^>]*)\/>/.exec(header)?.[1] ?? "";
  assert.match(box, /data-ui="header-actions"/, "landmark: the actions box");
  assert.match(box, /data-header-actions=""/, "the page's actions take the header buttons' look there (ruling R6)");
  assert.match(box, /className="[^"]*\bmin-w-0\b[^"]*"/, "min-w-0: it never pushes the printer button off screen");
  const page = read(path.join(CAFE_ROOT, "components/shared/PageHeader.tsx"));
  assert.match(page, /useLayoutEffect\(/, "the page registers before the first paint (no subtitle flash)");
  assert.match(page, /register\(\{ title, description, eyebrow: eyebrowText, back \}\)/, "it registers its title, subtitle and eyebrow");
});

// U0 Task 4 retired ruling R5's interim menu button: a phone's nav is the tab bar now (lib/tab-bar-paths.test.ts), so
// the header starts with the cafe's mini logo at every width below 720px, as the HTML's.
test("the header has no nav toggle at any width: no sidebar trigger, no phone menu button", () => {
  const header = read(path.join(CAFE_ROOT, "components/layout/Header.tsx"));
  assert.ok(!header.includes("<SidebarTrigger"), "no sidebar toggle in the header (the nav is always on screen from 720px)");
  assert.ok(!header.includes("PhoneMenuButton") && !header.includes("setOpenMobile"), "no phone menu button (the tab bar is the phone's nav)");
  assert.match(header, /<BrandTile\b[^>]*size="mini"[^>]*className="tab:hidden"/, "landmark: the phone's mini logo leads the header");
});

test("ruling R4: no page shows its title twice — POS, Items and every report name their page through PageHeader", () => {
  const report = read(path.join(CAFE_ROOT, "components/reports/ReportHeader.tsx"));
  assert.match(report, /<PageHeader\s+eyebrow="Reports"\s+title=\{title\}\s+description=\{description\}\s+actions=\{/, "a report's title, line and Download CSV go to the header");
  assert.ok(report.includes("Download CSV") && report.includes("<RangeBar"), "Download CSV stays its action; the range row stays in the body");
  const items = read(path.join(CAFE_ROOT, "app/(dashboard)/products/page.tsx"));
  assert.match(items, /<PageHeader\s+eyebrow="Menu"\s+title="Items"\s+description=\{/, "the Items page's title block goes to the header");
  // Only the shell's header writes an <h1> on a staff page (the Dashboard's own title row moved there in Task 5).
  const allowed = new Set(["components/layout/HeaderTitle.tsx"]);
  const offenders: string[] = [];
  const scan = (dir: string) => {
    for (const entry of readdirSync(path.join(CAFE_ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) scan(rel);
      else if (rel.endsWith(".tsx") && !allowed.has(rel) && /<h1\b/.test(read(path.join(CAFE_ROOT, rel)))) offenders.push(rel);
    }
  };
  for (const dir of ["app/(dashboard)", "components/layout", "components/shared", "components/reports", "components/pos", "components/settings", "components/expenses", "components/menu"]) scan(dir);
  assert.deepEqual(offenders, [], "no other staff page or shared component writes its own <h1>");
});

test("PIN: the shell renders one slot provider around the header, the strip and the page", () => {
  const layout = read(path.join(CAFE_ROOT, "app/(dashboard)/layout.tsx"));
  assert.equal(count(layout, "<PageHeaderSlotProvider>"), 1, "one provider");
  const at = layout.indexOf("<PageHeaderSlotProvider>");
  assert.ok(at < layout.indexOf("<Header />") && layout.indexOf("<Header />") < layout.indexOf("<RequestAlertBar />"), "the provider wraps the header and the strip");
  // U0 Task 4: the page keeps 92px clear at its foot on a phone (the tab bar, values 2.1 screenPadB).
  const main = layout.indexOf('<main className="flex-1 p-4 pb-[92px] tab:pb-4 md:p-6">');
  assert.ok(main >= 0 && main < layout.indexOf("</PageHeaderSlotProvider>"), "and the page");
});
