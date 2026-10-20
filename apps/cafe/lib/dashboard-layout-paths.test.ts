import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { stripComments } from "@/lib/source-pin-utils";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import { menuItemsHref } from "@/lib/menu-sections";
import { presetRange } from "@/lib/dashboard/range";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { AttentionStrip, attentionItems } from "@/components/dashboard/AttentionStrip";
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { DashCard } from "@/components/dashboard/DashCard";
import { RangeBar } from "@/components/dashboard/RangeBar";
import { TodayReservations } from "@/components/dashboard/TodayReservations";
import { MoneyBreakdownCard } from "@/components/reports/MoneyBreakdownCard";
import type { DashboardData, DashboardLive } from "@/types/dashboard";
import type { Order, Reservation } from "@/types";

// The dashboard in the owner's mock-up arrangement (UI redesign, Task 18):
// every card, figure, word and link it had stays; only the order and the look
// change. The KPI row becomes the dark Net sales hero, the bill breakdown a
// receipt, the strip folds on a phone, the period picker is segmented.
// SalesHero, KpiChange, BillBreakdown, SalesReveal and the PinPad are imported inside their tests.

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => stripComments(readFileSync(path.join(HERE, "..", rel), "utf8"));
const PAGE = "app/(dashboard)/page.tsx";
const noop = () => {};
const TODAY = "2026-10-16";

function fixture(over: Partial<DashboardData> = {}): DashboardData {
  return {
    range: { from: TODAY, to: TODAY },
    mode: "hour",
    compare: { from: "2026-10-09", to: "2026-10-09", label: "vs Fri, 9 Oct" },
    kpis: {
      current: { sales: 48250, orders: 126, averageOrder: 383, collected: 46980 },
      previous: { sales: 42930, orders: 118, averageOrder: 364, collected: 46980 },
    },
    series: [],
    payments: [],
    topItems: [],
    slowItems: [],
    categories: [],
    channels: [],
    heat: { from: TODAY, to: TODAY, hours: [], avg: [], max: 0 },
    leaks: {
      cancelled: { count: 0, value: 0 },
      voids: { lines: 0, qty: 0, value: 0 },
      discounts: { orders: 0, amount: 0 },
      rewards: { orders: 0, amount: 0 },
    },
    money: { gross: 0, discount: 0, reward: 0, gst: 0, charges: 0 },
    duesCollected: 100,
    ...over,
  };
}

const ready = (over: Partial<DashboardData> = {}) => ({
  data: fixture(over),
  status: "ready" as const,
  updating: false,
  onRetry: noop,
  period: "Today",
  today: TODAY,
});

// WCAG relative luminance, for the colours the dark card sets on itself.
function luminance(hex: string): number {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// ── the arrangement ─────────────────────────────────────────────────────────

// U0 match (Task 5, values 3.0): the HTML's section order — the two three-up rows are [how guests paid | where orders
// came from | money leaks] and [top items | sales by category | slow movers], then busy hours on its own.
test("the page lays every card out in the HTML's order, and no longer renders the KPI row", () => {
  const page = readSrc(PAGE);
  const ORDER = [
    "<PageHeader",
    "<AttentionStrip",
    "<RangeBar",
    "<SalesHero",
    "<BillBreakdown",
    "<SalesCard",
    "<LiveFloorPanel",
    "<RecentOrders",
    "<TodayReservations",
    "<PaymentMixCard",
    "<ChannelsCard",
    "<LeaksCard",
    "<TopItemsCard",
    "<CategoriesCard",
    "<SlowItemsCard",
    "<BusyHoursCard",
  ];
  let last = -1;
  let lastName = "the start of the page";
  for (const needle of ORDER) {
    const at = page.indexOf(needle);
    assert.ok(at >= 0, `the page renders ${needle}`);
    assert.ok(at > last, `${needle} comes after ${lastName}`);
    last = at;
    lastName = needle;
  }
  assert.ok(!page.includes("<Kpi" + "Row"), "the four figures moved into the hero: the page must not render the KPI row");
  assert.match(page, /<BusyHoursCard \{\.\.\.cards\} \/>\s*<\/div>/, "busy hours closes the content, full width, on no row of its own grid");
});

// ── the frame (U0 match Task 5, values 2.5 and 3.0) ──────────────────────────

// Ruling R13 (Task 6 fix 1): the HTML's phone header holds End of day (logo · title · End of day · + · printer), so End of
// day is a phoneAction (in the header at every width, icon-only on a phone) and the date the action (the body row on a
// phone, where it still shows the chosen day).
test("the header names the page: PageHeader 'Dashboard' with the cafe line by default, End of day in the header at every width, the date beside it", () => {
  const page = readSrc(PAGE);
  assert.match(
    page,
    /<EndOfDayButton>\s*\{\(\{ button, picker \}\) => \(\s*<PageHeader\s+title="Dashboard"\s+className="gap-2\.5"\s+phoneActions=\{button\}\s+actions=\{picker\}\s*\/>\s*\)\}\s*<\/EndOfDayButton>/,
    "the page's header: its title, End of day as its phoneActions, the date as its actions (the HTML's 10px gap in the phone's body row)",
  );
  assert.ok(!/<PageHeader[^>]*\bdescription=/.test(page), "no description: the header's own '{cafe} · {weekday, day month}' line shows");
  assert.ok(!/<h1\b/.test(page), "the page writes no title of its own (the header's h1 is the page's)");
});

test("the content measures as values 3.0: an @container as wide as cw, then 20px 24px 28px (16px 14px 92px on a phone), gap 16, no max-width", async () => {
  const page = readSrc(PAGE);
  const { MAIN_PADDING_BLEED_CLASS } = await import("@/lib/shell-layout");
  const pageBox = /<div data-ui="dash-page" className=\{`([^`]*)`\}>/.exec(page)?.[1] ?? "";
  assert.ok(pageBox.includes("@container"), "the dashboard page is the query container for the HTML's cw rules");
  assert.ok(pageBox.includes("${MAIN_PADDING_BLEED_CLASS}"), "it bleeds over <main>'s padding, so it is exactly cw wide (the HTML's viewport minus the nav)");
  const content = /<div data-ui="dash-content" className="([^"]*)">/.exec(page)?.[1] ?? "";
  for (const cls of ["flex", "flex-col", "gap-4", "px-[14px]", "pt-4", "pb-[92px]", "tab:px-6", "tab:pt-5", "tab:pb-7", "leading-[normal]", "text-foreground"]) {
    assert.ok(content.split(" ").includes(cls), `the content box has ${cls}`);
  }
  assert.ok(!/\bmax-w-|\bmx-auto\b/.test(content), "max-width:none (the HTML's content is as wide as the page)");
  for (const gone of ["bg-brand-paper", "min-h-[calc(100svh-3.5rem)]", "max-w-[1440px]"]) {
    assert.ok(!page.includes(gone), `the old Paper & Ink wrapper's ${gone} is gone`);
  }
  // The bleed mirrors <main>'s own padding (pinned in lib/pos-layout-paths.test.ts), class for class.
  const layout = readSrc("app/(dashboard)/layout.tsx");
  const mainPad = /<main className="flex-1 ([^"]*)">/.exec(layout)?.[1] ?? "";
  assert.equal(mainPad, "p-4 pb-[92px] tab:pb-4 md:p-6", "landmark: <main>'s padding");
  const mirrored = mainPad.split(" ").map((t) => t.replace(/^((?:[a-z]+:)?)p/, "$1-m")).join(" ");
  assert.equal(MAIN_PADDING_BLEED_CLASS, mirrored, "the bleed negates <main>'s padding at every width, no more and no less");
});

test("every row takes the HTML's column template per content width (db.L hero, twoOne, three, span3)", () => {
  const page = readSrc(PAGE);
  const count = (needle: string) => page.split(needle).length - 1;
  assert.equal(count('className="grid grid-cols-1 gap-4 @min-[1000px]:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]"'), 1, "hero: 1.7fr | minmax(300px,1fr) from cw 1000");
  assert.equal(count('className="grid grid-cols-1 gap-4 @min-[1000px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"'), 2, "twoOne (chart | tables, orders | reservations): 2fr | 1fr from cw 1000");
  assert.equal(count('className="grid grid-cols-1 gap-4 @min-[680px]:grid-cols-2 @min-[1080px]:grid-cols-3"'), 2, "three: two columns from cw 680, three from 1080");
  assert.equal(count('className="@min-[680px]:col-span-full @min-[1080px]:col-auto"'), 2, "span3: Money leaks and Slow movers span the row from 680 to 1079");
  assert.match(page, /<LeaksCard \{\.\.\.cards\} className="@min-\[680px\]:col-span-full/, "Money leaks spans");
  assert.match(page, /<SlowItemsCard \{\.\.\.cards\} className="@min-\[680px\]:col-span-full/, "Slow movers spans");
  assert.ok(!/\b(?:sm|md|lg|xl):(?:grid-cols|col-span)/.test(page), "no viewport breakpoints left on the rows: the HTML's rules read the content width");
});

// Fix round 1: the inline look had no consumer (only the dashboard renders it), so the component is the header pair.
test("EndOfDayButton: End of day then the date, as the HTML's 36px outline header buttons; the chosen day always in words", () => {
  const src = readSrc("components/reports/EndOfDayButton.tsx");
  assert.match(src, /export function EndOfDayButton\(\{ children \}: \{ children: \(parts: EndOfDayParts\) => ReactNode \}\) \{/, "one look: the header pair, handed to the caller (ruling R13)");
  assert.ok(!/CalendarCheck|variant = "inline"|"h-8 w-auto"/.test(src), "the old inline look is gone");
  // values 2.5: outline, the printer glyph, the HTML's words and title; the label hides below 560px (the HTML's wideI).
  assert.match(
    src,
    /<Button\s+variant="outline"\s+className=\{HEADER_OUTLINE_BUTTON_CLASS\}\s+title="Print end-of-day report"\s+onClick=\{printEod\}\s+disabled=\{!ready \|\| enqueuePending\}\s*>\s*<GlyphPrinter aria-hidden="true" strokeWidth=\{1\.8\} \/>\s*<span className=\{HEADER_LABEL_CLASS\}>End of day<\/span>/,
    "End of day: outline, the printer glyph, its words hidden below 560px, the HTML's title (the icon-only button's name)",
  );
  assert.ok(src.includes('const HEADER_LABEL_CLASS = "hidden min-[560px]:inline";'), "the HTML's wideI: words from 560px");
  // The date has no HTML twin: its words stay on a phone too, so a picked past day always shows which day will print.
  assert.match(src, /<NavBookings aria-hidden="true" strokeWidth=\{1\.8\} \/>\s*<span>\{shortDay\}<\/span>/, "the calendar glyph and the day, never hidden");
  assert.ok(src.includes("aria-label={`End of day date: ${shortDay}`}"), "its name carries the visible day");
  assert.ok(src.includes('{ day: "numeric", month: "short", timeZone: CAFE_TIMEZONE }'), "the date reads '19 Oct'");
  assert.match(src, /<>\s*\{children\(\{ button, picker \}\)\}/, "End of day and the date go where the caller puts them; the print source stays here");
});

test("DatePicker: a label replaces the trigger's calendar icon and full date (the dashboard's short header button)", async () => {
  const { DatePicker } = await import("@/components/shared/DatePicker");
  const plain = renderToStaticMarkup(createElement(DatePicker, { value: "2026-10-19", onChange: noop }));
  assert.ok(plain.includes("19 Oct 2026") && plain.includes("lucide-calendar"), "landmark: the default trigger shows the icon and the full date");
  const custom = renderToStaticMarkup(createElement(DatePicker, { value: "2026-10-19", onChange: noop, label: createElement("span", null, "19 Oct") }));
  assert.ok(custom.includes("<span>19 Oct</span>"), "the label is the trigger's content");
  assert.ok(!custom.includes("19 Oct 2026") && !custom.includes("lucide-calendar"), "instead of the icon and the full date");
});

test("the period row: the period's name 18/600, the dates and comparison 12.5 text-2, the segmented picker at the right", () => {
  const page = readSrc(PAGE);
  assert.match(page, /<div data-ui="period-row" className="flex flex-wrap items-end justify-between gap-3">/, "flex, wrap, align end, space-between, gap 12");
  assert.match(page, /<h2 data-ui="period-title" className="text-\[18px\] font-semibold tracking-\[-0\.01em\]">\{periodName\}<\/h2>/, "the title");
  assert.match(
    page,
    /<p data-ui="period-sub" className="mt-0\.5 text-\[12\.5px\] text-muted-foreground">\s*\{periodSubline\(shownRange, today\)\}\s*<\/p>/,
    "the sub line: one 17px line, its words from the range alone (ruling R9: never Loading…, never moving)",
  );
  assert.match(page, /<RangeBar variant="dashboard" value=\{selection\} onChange=\{onSelect\} isAdmin=\{isAdmin\} \/>/, "the picker in the HTML's segmented look");
});

// ── KpiCard, byte for byte (golden captured from the code before KpiChange) ──

const KPI_BASE = { compareLabel: "vs last Friday", noCompareText: "No orders on Fri, 9 Oct" };
const KPI_CASES: Record<string, React.ComponentProps<typeof KpiCard>> = {
  upHint: { ...KPI_BASE, label: "Net sales", value: "₹12,345", delta: 0.124, hint: "+ ₹100 paid against earlier dues" },
  downGoodUpdating: { ...KPI_BASE, label: "Cancelled", value: "3", delta: -0.25, upIsGood: false, updating: true },
  downBad: { ...KPI_BASE, label: "Orders", value: "42", delta: -0.062 },
  flat: { ...KPI_BASE, label: "Average order", value: "₹294", delta: 0 },
  none: { ...KPI_BASE, label: "Collected", value: "₹0", delta: null },
  loading: { ...KPI_BASE, label: "Net sales", value: "₹0", delta: null, loading: true },
};
const KPI_GOLDEN: Record<string, string> = {
  upHint:
    '<section class="min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5 flex flex-col gap-1.5"><h3 class="text-[13px] font-medium text-brand-muted">Net sales</h3><div class="transition-opacity duration-200"><p class="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">₹12,345</p><p class="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5 min-h-10 sm:min-h-5 text-brand-up"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-up-right h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M7 7h10v10"></path><path d="M7 17 17 7"></path></svg><span class="sr-only">Up</span><span class="font-medium">12%</span><span class="text-brand-muted">vs last Friday</span></p><p class="mt-0.5 min-h-4 text-[12px] leading-4 text-brand-muted">+ ₹100 paid against earlier dues</p></div></section>',
  downGoodUpdating:
    '<section class="min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5 flex flex-col gap-1.5" aria-busy="true"><h3 class="text-[13px] font-medium text-brand-muted">Cancelled</h3><div class="transition-opacity duration-200 opacity-55"><p class="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">3</p><p class="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5 min-h-10 sm:min-h-5 text-brand-up"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-right h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="m7 7 10 10"></path><path d="M17 7v10H7"></path></svg><span class="sr-only">Down</span><span class="font-medium">25%</span><span class="text-brand-muted">vs last Friday</span></p><p class="mt-0.5 min-h-4 text-[12px] leading-4 text-brand-muted"></p></div></section>',
  downBad:
    '<section class="min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5 flex flex-col gap-1.5"><h3 class="text-[13px] font-medium text-brand-muted">Orders</h3><div class="transition-opacity duration-200"><p class="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">42</p><p class="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5 min-h-10 sm:min-h-5 text-brand-danger"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-down-right h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="m7 7 10 10"></path><path d="M17 7v10H7"></path></svg><span class="sr-only">Down</span><span class="font-medium">6.2%</span><span class="text-brand-muted">vs last Friday</span></p><p class="mt-0.5 min-h-4 text-[12px] leading-4 text-brand-muted"></p></div></section>',
  flat:
    '<section class="min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5 flex flex-col gap-1.5"><h3 class="text-[13px] font-medium text-brand-muted">Average order</h3><div class="transition-opacity duration-200"><p class="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">₹294</p><p class="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5 min-h-10 sm:min-h-5 text-brand-muted"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-minus h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M5 12h14"></path></svg><span class="sr-only">No change,</span><span class="font-medium">0%</span><span class="text-brand-muted">vs last Friday</span></p><p class="mt-0.5 min-h-4 text-[12px] leading-4 text-brand-muted"></p></div></section>',
  none:
    '<section class="min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5 flex flex-col gap-1.5"><h3 class="text-[13px] font-medium text-brand-muted">Collected</h3><div class="transition-opacity duration-200"><p class="text-[26px] font-semibold leading-8 tracking-[-0.01em] text-brand-ink">₹0</p><p class="mt-1 flex flex-wrap items-center gap-x-1 text-[12.5px] leading-5 min-h-10 sm:min-h-5 text-brand-muted"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-minus h-3.5 w-3.5 shrink-0" aria-hidden="true"><path d="M5 12h14"></path></svg><span>No orders on Fri, 9 Oct</span></p><p class="mt-0.5 min-h-4 text-[12px] leading-4 text-brand-muted"></p></div></section>',
  loading:
    '<section class="min-w-0 rounded-xl border border-brand-rule bg-brand-slip p-4 sm:p-5 flex flex-col gap-1.5" aria-busy="true"><h3 class="text-[13px] font-medium text-brand-muted">Net sales</h3><div><div aria-hidden="true" class="rounded-md bg-brand-wash motion-safe:animate-pulse h-8 w-28"></div><div class="mt-1 flex items-center min-h-10 sm:min-h-5"><div aria-hidden="true" class="rounded-md bg-brand-wash motion-safe:animate-pulse h-4 w-40"></div></div><div class="mt-0.5 min-h-4"></div></div></section>',
};

test("KpiCard renders byte for byte what it rendered before its change line moved into KpiChange (the reports pages use it)", () => {
  assert.deepEqual(Object.keys(KPI_GOLDEN), Object.keys(KPI_CASES), "one golden per case");
  for (const [name, props] of Object.entries(KPI_CASES)) {
    assert.equal(renderToStaticMarkup(createElement(KpiCard, props)), KPI_GOLDEN[name], `KpiCard "${name}" markup is unchanged`);
  }
  assert.ok(readSrc("components/dashboard/KpiCard.tsx").includes("<KpiChange"), "KpiCard renders the extracted KpiChange");
});

// sha256 of KpiRow's markup for fixture(), captured before kpiFigures existed.
const KPI_ROW_SHA256 = {
  ready: "dcde178a9f9cab1b79d823576d0031228e814a4304de6992f1224914f88c2967",
  loading: "0d92346647d9f1f1c3cfc89a240ec561cd4872669d9b84fb5528d5940757ce50",
};
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

test("KpiRow maps kpiFigures with its output unchanged; kpiFigures gives the four figures in order", async () => {
  const { KpiRow, kpiFigures } = await import("@/components/dashboard/RangeCards");
  assert.equal(typeof kpiFigures, "function", "RangeCards exports kpiFigures");
  const html = renderToStaticMarkup(createElement(KpiRow, ready()));
  assert.equal(sha256(html), KPI_ROW_SHA256.ready, "KpiRow (ready) renders exactly what it rendered before");
  const loading = renderToStaticMarkup(createElement(KpiRow, { ...ready(), data: undefined, status: "loading" as const }));
  assert.equal(sha256(loading), KPI_ROW_SHA256.loading, "KpiRow (loading) renders exactly what it rendered before");

  const figures = kpiFigures(fixture());
  assert.deepEqual(
    figures.map((f) => f.label),
    ["Net sales", "Orders", "Average order", "Collected"],
    "the four figures in today's order",
  );
  assert.deepEqual(
    figures.map((f) => f.value),
    ["₹48,250", "126", "₹383", "₹46,980"],
    "today's value wording",
  );
  assert.deepEqual(
    figures.map((f) => f.hint),
    [undefined, undefined, undefined, "+ ₹100 paid against earlier dues"],
    "only Collected carries the earlier-dues hint",
  );
  assert.equal(kpiFigures(fixture({ duesCollected: 0 }))[3].hint, undefined, "no hint when no earlier dues were paid");
  assert.ok(figures.every((f) => f.compareLabel === "vs Fri, 9 Oct" && f.upIsGood), "same compare label, up is good");
});

// ── the Net sales hero (U0 match Task 6, values 3.3, 3.17, ruling R12) ────────

// fixture(): Friday 16 Oct against Friday 9 Oct. Net sales +12.4 %, Orders +6.8 %, Average order +5.2 %, Collected flat.
const hero = async (over: Partial<DashboardData> = {}, extra: Record<string, unknown> = {}) => {
  const { SalesHero } = await import("@/components/dashboard/SalesHero");
  return renderToStaticMarkup(createElement(SalesHero, { ...ready(over), shown: false, ...extra }));
};
/** The opening tag of the first element carrying data-ui="name" (nth = which one). */
const tagOf = (html: string, name: string, nth = 0): string => (html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [])[nth] ?? "";
const clsOf = (tag: string): string[] => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
const expectAll = (tag: string, classes: string[], label: string) => {
  for (const c of classes) assert.ok(clsOf(tag).includes(c), `${label} has ${c} (got "${clsOf(tag).join(" ")}")`);
};

test("SalesHero: the HTML's dark card - --nav, a 1px --nav-2 border, radius 16, padding 20 | 24px 26px from cw 560, a 22px column gap", async () => {
  const html = await hero();
  const section = tagOf(html, "hero");
  assert.ok(section.startsWith("<section"), "the hero is a section");
  expectAll(section, ["flex", "min-w-0", "flex-col", "gap-[22px]", "rounded-[16px]", "border", "border-nav-2", "bg-nav", "p-5", "@min-[560px]:px-[26px]", "@min-[560px]:py-6", "text-white"], "the hero");
  assert.ok(section.includes("motion-safe:animate-[brand-rise_0.5s_cubic-bezier(0.2,0.8,0.2,1)_both]"), "the HTML's rise .5s");
  assert.ok(!/\bbg-ink(?![\w-])|\btext-on-ink(?![\w-])|\bsm:/.test(html), "no ink card, no on-ink text, no viewport breakpoint left");
  expectAll(tagOf(html, "hero-top"), ["flex", "flex-wrap", "items-start", "justify-between", "gap-3"], "the top row");
  const label = tagOf(html, "hero-label");
  expectAll(label, ["text-[13px]", "text-[#a1a1aa]"], "the label");
  assert.ok(html.includes(">Net sales · Today<"), "the label reads 'Net sales · {period}'");
});

test("SalesHero: the figure in Geist Mono 500, 42 | 60 px from cw 560, -0.04em, line-height 1, 10px under the label", async () => {
  const figure = tagOf(await hero({}, { shown: true }), "hero-figure");
  expectAll(figure, ["mt-2.5", "font-mono", "font-medium", "text-[42px]", "@min-[560px]:text-[60px]", "tracking-[-0.04em]", "leading-none"], "the figure");
});

test("SalesHero masked (the default, values 3.17): '₹ • • • •' for Net sales, Average order and Collected, 'still due hidden'", async () => {
  const html = await hero();
  // Fix 1: the bullets are hidden from a screen reader, which hears "{figure} hidden" instead of each bullet.
  assert.match(html, /data-ui="hero-figure"[^>]*><span aria-hidden="true">₹ • • • •<\/span><span class="sr-only">Net sales hidden<\/span><\/p>/, "the hero's figure is masked, named for a screen reader");
  const values = [...html.matchAll(/data-ui="hero-mini-value"[^>]*>(.*?)<\/span>(?:<\/span>)?<div/g)].map((m) => m[1]);
  assert.deepEqual(
    values,
    ["126", '<span aria-hidden="true">₹ • • • •</span><span class="sr-only">Average order hidden', '<span aria-hidden="true">₹ • • • •</span><span class="sr-only">Collected hidden'],
    "Orders shows; Average order and Collected are masked, each named for a screen reader",
  );
  assert.ok(html.includes("still due hidden"), "Collected's note while masked");
  assert.ok(!/₹48,250|₹383|₹46,980|₹1,270/.test(html), "no sales figure anywhere while masked");
  assert.ok(html.includes("↑ 12.4%") && html.includes("↑ 6.8%") && html.includes("↑ 5.2%"), "every change % stays visible");
  assert.ok(!html.includes("earlier dues") && !html.includes('data-ui="hero-dues"'), "our earlier-dues line (ruling R12) is its amount: masked, it is left out");
});

test("SalesHero shown: the figures, '₹1,270 still due' (sales - collected) and our earlier-dues line", async () => {
  const html = await hero({}, { shown: true });
  assert.match(html, /data-ui="hero-figure"[^>]*>₹48,250</, "Net sales");
  const values = [...html.matchAll(/data-ui="hero-mini-value"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(values, ["126", "₹383", "₹46,980"], "the three minis");
  const labels = [...html.matchAll(/data-ui="hero-mini-label"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Orders", "Average order", "Collected"], "the minis' labels");
  const notes = [...html.matchAll(/data-ui="hero-mini-note"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(notes, ["vs last fri", "per bill", "₹1,270 still due"], "the notes: vs {cmpShort}, per bill, still due");
  assert.ok(html.includes("+ ₹100 paid against earlier dues"), "the earlier-dues line (ruling R12)");
  expectAll(tagOf(html, "hero-dues"), ["text-[12px]", "text-[#a1a1aa]"], "the dues line: 12px #A1A1AA");
  const allCollected = await hero({ kpis: { current: { sales: 500, orders: 2, averageOrder: 250, collected: 500 }, previous: { sales: 400, orders: 2, averageOrder: 200, collected: 400 } } }, { shown: true });
  assert.ok(allCollected.includes("all collected"), "nothing due: 'all collected'");
  const noDues = await hero({ duesCollected: 0 }, { shown: true });
  assert.ok(!noDues.includes("earlier dues") && !noDues.includes('data-ui="hero-dues"'), "no earlier-dues line without earlier dues");
});

test("SalesHero: the delta row - the pill '↑ 12.4%' (24px, 0 9px, radius 12, 600, the hero's green), then 'vs' and the comparison as their own items, gap 8", async () => {
  const html = await hero();
  expectAll(tagOf(html, "hero-delta"), ["mt-3", "flex", "items-center", "gap-2", "text-[13px]", "text-[#a1a1aa]"], "the delta row");
  const pill = tagOf(html, "hero-pill");
  expectAll(pill, ["flex", "h-6", "items-center", "rounded-[12px]", "px-[9px]", "font-semibold", "text-on-ink-up", "bg-on-ink-up-tint"], "the pill");
  assert.match(html, /data-ui="hero-delta"[^>]*><span [^>]*data-ui="hero-pill"[^>]*><span class="sr-only">Up<\/span>↑ 12\.4%<\/span><span>vs<\/span><span>last Friday<\/span>/, "pill, 'vs', 'last Friday': three flex items (values 0.2)");
  const down = await hero({ kpis: { current: { sales: 900, orders: 3, averageOrder: 300, collected: 900 }, previous: { sales: 1000, orders: 3, averageOrder: 300, collected: 900 } } });
  expectAll(tagOf(down, "hero-pill"), ["text-on-ink-down", "bg-on-ink-down-tint"], "a fall wears the hero's red");
  assert.match(down, /<span class="sr-only">Down<\/span>↓ 10%</, "'↓ 10%' (the HTML's one decimal, a whole number without one)");
});

test("SalesHero (ruling R12): a flat change is a grey '0%' pill; no comparison data -> no pill, 'No orders last Friday'", async () => {
  const flat = await hero({ kpis: { current: { sales: 500, orders: 2, averageOrder: 250, collected: 500 }, previous: { sales: 500, orders: 2, averageOrder: 250, collected: 500 } } });
  expectAll(tagOf(flat, "hero-pill"), ["bg-on-ink/10", "text-[#a1a1aa]"], "the flat pill");
  assert.match(flat, /<span class="sr-only">No change,<\/span>0%</, "'0%', said as no change");
  const none = await hero({ kpis: { current: { sales: 500, orders: 2, averageOrder: 250, collected: 500 }, previous: { sales: 0, orders: 0, averageOrder: 0, collected: 0 } } });
  assert.ok(!none.includes('data-ui="hero-pill"'), "no pill without a comparison");
  assert.match(none, /data-ui="hero-delta"[^>]*><span>No orders last Friday<\/span>/, "the line says the comparison had no orders");
  const minis = [...none.matchAll(/data-ui="hero-mini-delta"[^>]*>([\s\S]*?)<\/span><\/span>/g)].map((m) => m[1]);
  assert.equal(minis.length, 3, "three mini change lines");
  assert.ok(!/[↑↓]/.test(minis.join("")), "no arrow on a mini without a comparison");
  const notes = [...none.matchAll(/data-ui="hero-mini-note"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(notes, ["No orders last Friday", "per bill", "still due hidden"], "Orders says why; the other notes stay");
});

test("SalesHero: the minis - 1 | 3 columns from cw 560, gap 16, 18px over a --nav-2 rule; 12.5 label, mono 24/500 value, 12/500 change + a 400 note", async () => {
  const html = await hero();
  expectAll(tagOf(html, "hero-minis"), ["grid", "grid-cols-1", "@min-[560px]:grid-cols-3", "gap-4", "border-t", "border-nav-2", "pt-[18px]"], "the minis grid");
  expectAll(tagOf(html, "hero-mini"), ["flex", "min-w-0", "flex-col", "gap-1.5"], "a mini");
  expectAll(tagOf(html, "hero-mini-label"), ["text-[12.5px]", "text-[#a1a1aa]"], "a mini's label");
  expectAll(tagOf(html, "hero-mini-value"), ["font-mono", "text-[24px]", "font-medium", "tracking-[-0.03em]", "whitespace-nowrap"], "a mini's value");
  expectAll(tagOf(html, "hero-mini-delta"), ["text-[12px]", "font-medium", "text-on-ink-up"], "a mini's change");
  expectAll(tagOf(html, "hero-mini-note"), ["font-normal", "text-[#a1a1aa]"], "a mini's note");
  assert.match(html, /data-ui="hero-mini-delta"[^>]*><span class="sr-only">Up<\/span>↑ 6\.8% <span [^>]*data-ui="hero-mini-note"/, "'↑ 6.8% ' then the note, inline");
  assert.match(tagOf(html, "hero-mini-delta", 2), /text-\[#a1a1aa\]/, "Collected's flat change is grey (ruling R12)");
});

test("SalesHero: the reveal controls sit in the right column; loading keeps the labels with skeletons; updating dims", async () => {
  const slot = createElement("span", { "data-probe": "reveal" }, "the reveal");
  const html = await hero({}, { reveal: slot });
  assert.ok(html.indexOf('data-probe="reveal"') > html.indexOf('data-ui="hero-delta"'), "the reveal controls come after the figure block");
  assert.ok(html.indexOf('data-probe="reveal"') < html.indexOf('data-ui="hero-minis"'), "and before the minis (the top row's right column)");
  const { SalesHero } = await import("@/components/dashboard/SalesHero");
  const loading = renderToStaticMarkup(createElement(SalesHero, { ...ready(), data: undefined, status: "loading" as const, shown: true }));
  for (const label of ["Net sales", "Orders", "Average order", "Collected"]) assert.ok(loading.includes(label), `loading still names ${label}`);
  assert.ok(loading.includes('aria-busy="true"'), "loading is busy");
  assert.ok(!loading.includes("₹"), "no figure while loading");
  assert.ok(loading.includes("animate-pulse"), "skeletons while loading");
  const updating = await hero({}, { updating: true });
  assert.ok(updating.includes("opacity-55") && updating.includes('aria-busy="true"'), "the old range's figures dim while the new one loads");
  const ready0 = await hero();
  assert.ok(!ready0.includes('aria-busy="true"'), "a ready hero is not busy");
});

test("SalesHero: the count-up (values 3.2) scales Net sales, Orders and Collected by grow; Average order never counts", async () => {
  const html = await hero({}, { shown: true, grow: 0.5 });
  assert.match(html, /data-ui="hero-figure"[^>]*>₹24,125</, "half of ₹48,250");
  const values = [...html.matchAll(/data-ui="hero-mini-value"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(values, ["63", "₹383", "₹23,490"], "Orders and Collected count, Average order does not");
  assert.ok(html.includes("₹1,270 still due"), "the still-due note never counts");
});

test("KpiChange's hero set: the HTML's #6FDC8C / #FF8389 as tokens, the 16 % pills flattened over --nav, 4.5:1 on the card and the pill", async () => {
  const { KPI_CHANGE_DARK, heroChange } = await import("@/components/dashboard/KpiChange");
  const css = readFileSync(path.join(HERE, "..", "app/globals.css"), "utf8");
  const lightBlock = /:root\s*\{[^}]*?--on-ink-up:[^}]*\}/.exec(css)?.[0] ?? "";
  const nav = /--nav:\s*(#[0-9a-f]{6});/i.exec(lightBlock)?.[1];
  assert.equal(nav, "#111113", "landmark: the hero's card is --nav #111113");
  assert.ok(!/#[0-9a-f]{6}/i.test(KPI_CHANGE_DARK.good + KPI_CHANGE_DARK.bad), "no literal hex in the hero's up and down text colours");
  const want = { good: ["on-ink-up", "#6fdc8c", "#192d20"], bad: ["on-ink-down", "#ff8389", "#361b1e"] } as const;
  for (const way of ["good", "bad"] as const) {
    const [token, text, tint] = want[way];
    assert.equal(KPI_CHANGE_DARK[way], `text-${token}`, `the hero's ${way} text is text-${token}`);
    assert.equal(KPI_CHANGE_DARK[`${way}Pill`], `bg-${token}-tint`, `the hero's ${way} pill is bg-${token}-tint`);
    assert.ok(themeHas(css, token) && themeHas(css, `${token}-tint`), `--color-${token} and its tint are registered in @theme inline`);
    assert.equal(new RegExp(`--${token}: *(#[0-9a-f]{6});`, "i").exec(lightBlock)?.[1], text, `--${token} is the HTML's ${text}`);
    assert.equal(new RegExp(`--${token}-tint: *(#[0-9a-f]{6});`, "i").exec(lightBlock)?.[1], tint, `--${token}-tint is the HTML's 16 % tint flattened over --nav (${tint})`);
    assert.ok(contrast(text, nav) >= 4.5, `${text} on the card ${nav} is ${contrast(text, nav).toFixed(2)}:1`);
    assert.ok(contrast(text, tint) >= 4.5, `${text} on its pill ${tint} is ${contrast(text, tint).toFixed(2)}:1`);
  }
  assert.equal(KPI_CHANGE_DARK.flat, "text-[#a1a1aa]", "a flat change and the notes are the HTML's #A1A1AA");
  assert.equal(KPI_CHANGE_DARK.flatPill, "bg-on-ink/10", "the flat pill (ruling R12)");
  assert.ok(contrast("#a1a1aa", nav) >= 4.5, "#A1A1AA on the card reads at 4.5:1");
  assert.deepEqual(heroChange(0.124), { text: "↑ 12.4%", said: "Up", way: "good" }, "dl(12.4): one decimal");
  assert.deepEqual(heroChange(-0.021), { text: "↓ 2.1%", said: "Down", way: "bad" }, "dl(-2.1)");
  assert.deepEqual(heroChange(0.2), { text: "↑ 20%", said: "Up", way: "good" }, "a whole number shows no decimal, as the HTML's own number");
  assert.deepEqual(heroChange(0), { text: "0%", said: "No change,", way: "flat" }, "flat: '0%' (ruling R12)");
  assert.deepEqual(heroChange(0.0004), { text: "0%", said: "No change,", way: "flat" }, "under 0.05 % reads as no change");
  assert.equal(heroChange(null), null, "no comparison");
});

function themeHas(css: string, name: string): boolean {
  return css.includes(`--color-${name}: var(--${name});`);
}

// ── the bill breakdown (U0 match Task 6, values 3.4, 3.17) ───────────────────

const bill = async (over: Partial<DashboardData> = {}, extra: Record<string, unknown> = {}) => {
  const { BillBreakdown } = await import("@/components/dashboard/BillBreakdown");
  const money = { gross: 47120, discount: 1840, reward: 260, gst: 2480, charges: 750 };
  return renderToStaticMarkup(createElement(BillBreakdown, { ...ready({ money, ...over }), shown: true, ...extra }));
};

test("BillBreakdown: the HTML receipt - surface, a border with no foot, radius 16 16 0 0, padding 20 22 26, 8px below, the torn edge", async () => {
  const html = await bill();
  const section = tagOf(html, "bill");
  assert.ok(section.startsWith("<section"), "the receipt is a section");
  expectAll(section, ["relative", "mb-2", "min-w-0", "rounded-t-[16px]", "border", "border-b-0", "border-border", "bg-card", "px-[22px]", "pt-5", "pb-[26px]"], "the receipt");
  assert.ok(section.includes("motion-safe:animate-[brand-rise_0.5s_0.06s_cubic-bezier(0.2,0.8,0.2,1)_both]"), "the HTML's rise .5s, .06s late");
  const edge = tagOf(html, "bill-edge");
  expectAll(edge, ["absolute", "-left-px", "-right-px", "-bottom-2", "h-[9px]"], "the torn edge");
  assert.ok(edge.includes("radial-gradient(circle at 7px 9px,transparent 5px,var(--color-card) 5.5px) 0 0/14px 9px repeat-x"), "the HTML's radial gradient, verbatim");
  assert.ok(!html.includes("mask") && !html.includes("border-dotted"), "no mask and no dotted leaders (the reports' receipt keeps those)");
});

test("BillBreakdown: the head, the dashed rules 14/6 and 6/12, our rows in our words with the HTML's colours and − / + signs", async () => {
  const html = await bill();
  expectAll(tagOf(html, "bill-head"), ["flex", "items-baseline", "justify-between", "gap-2"], "the head");
  assert.match(html, /<h2 [^>]*class="text-\[15px\] font-semibold"[^>]*>Bill breakdown<\/h2>/, "the title 15/600");
  expectAll(tagOf(html, "bill-tag"), ["font-mono", "text-[11px]", "uppercase", "tracking-[0.06em]", "text-subtle-foreground"], "the period tag");
  assert.match(html, /data-ui="bill-tag"[^>]*>Today</, "the tag is the period's short name (upper-cased by CSS)");
  expectAll(tagOf(html, "bill-rule", 0), ["mt-3.5", "mb-1.5", "border-t-[1.5px]", "border-dashed", "border-border"], "the first rule");
  expectAll(tagOf(html, "bill-rule", 1), ["mt-1.5", "mb-3", "border-t-[1.5px]", "border-dashed", "border-border"], "the second rule");
  const rows = [...html.matchAll(/<div [^>]*data-ui="bill-row"[^>]*><span>([^<]*)<\/span><span class="font-mono">([^<]*)<\/span><\/div>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(
    rows,
    [
      ["Gross bill", "₹47,120"],
      ["Discounts", "− ₹1,840"],
      ["Rewards given", "− ₹260"],
      ["GST added", "+ ₹2,480"],
      ["Additional charges", "+ ₹750"],
    ],
    "our five rows in MONEY_BREAKDOWN_LINES order, our words, the HTML's U+2212 minus",
  );
  assert.deepEqual(MONEY_BREAKDOWN_LINES.map((l) => l.label), rows.map((r) => r[0]), "the rows follow the shared label table");
  const colours = [0, 1, 2, 3, 4].map((i) => clsOf(tagOf(html, "bill-row", i)).find((c) => c.startsWith("text-") && c !== "text-[13.5px]"));
  assert.deepEqual(colours, ["text-foreground", "text-status-bad-ink", "text-status-bad-ink", "text-muted-foreground", "text-muted-foreground"], "text, bad-i, bad-i, text-2, text-2");
  expectAll(tagOf(html, "bill-row"), ["flex", "justify-between", "gap-3", "py-[7px]", "text-[13.5px]"], "a row");
  expectAll(tagOf(html, "bill-total"), ["flex", "items-baseline", "justify-between"], "the total");
  assert.match(html, /data-ui="bill-total"[^>]*><span class="text-\[15px\] font-semibold">Net sales<\/span><span [^>]*class="font-mono text-\[22px\] font-semibold tracking-\[-0\.02em\]"[^>]*>₹48,250<\/span>/, "Net sales 15/600, its value mono 22/600 -0.02em");
});

test("BillBreakdown masked: every row '• • • •' in text-3, its label too; the total '₹ • • • •'", async () => {
  const html = await bill({}, { shown: false });
  const rows = [...html.matchAll(/data-ui="bill-row"[^>]*>[\s\S]*?<span class="font-mono">(.*?)<\/span><\/div>/g)].map((m) => m[1]);
  assert.deepEqual(rows, Array(5).fill('<span aria-hidden="true">• • • •</span><span class="sr-only">hidden</span>'), "five masked rows, each 'hidden' to a screen reader");
  for (let i = 0; i < 5; i += 1) assert.ok(clsOf(tagOf(html, "bill-row", i)).includes("text-subtle-foreground"), `row ${i + 1} is text-3`);
  assert.match(html, /data-ui="bill-total"[\s\S]*?><span aria-hidden="true">₹ • • • •<\/span><span class="sr-only">hidden<\/span>/, "the total is masked, 'Net sales hidden' to a screen reader");
  assert.ok(!/₹[0-9]/.test(html), "no amount anywhere");
});

test("BillBreakdown: the period tag is the HTML's short name - a day as its date, a span as N days; loading keeps the frame", async () => {
  const tag = (range: { from: string; to: string }) => bill({ range });
  assert.match(await tag({ from: "2026-10-15", to: "2026-10-15" }), /data-ui="bill-tag"[^>]*>15 Oct</, "yesterday: its date");
  assert.match(await tag({ from: "2026-10-10", to: TODAY }), /data-ui="bill-tag"[^>]*>7 days</, "7 days");
  const { BillBreakdown } = await import("@/components/dashboard/BillBreakdown");
  const loading = renderToStaticMarkup(createElement(BillBreakdown, { ...ready(), data: undefined, status: "loading" as const, shown: true }));
  assert.ok(loading.includes("Bill breakdown") && loading.includes('aria-busy="true"'), "the title stays, busy");
  assert.ok(!loading.includes("₹") && loading.includes("animate-pulse"), "skeleton rows, no amount");
});

// ── the reveal (U0 match Task 6, values 3.16, design 7) ──────────────────────

test("PinPad size 'reveal': 50px keys, radius 14, digits 24/500, Clear 14, ⌫ 20 on no fill, gap 8; 14px dots 16 apart; an error rings and fills them", async () => {
  const { PinPad } = await import("@/components/ui/pin-pad");
  const tones = { dotEmpty: "border-subtle-foreground", dotErrorFill: "bg-status-bad-tint", message: "text-status-bad-ink", key: "active:bg-surface-3" };
  const html = renderToStaticMarkup(createElement(PinPad, { value: "12", onChange: noop, onComplete: noop, size: "reveal", tones, prompt: "Asha, enter your PIN" }));
  const keys = html.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
  assert.equal(keys.length, 12, "twelve keys");
  assert.deepEqual(keys.map((k) => />([^<]*)<\/button>$/.exec(k)?.[1]), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Clear", "0", "⌫"], "1-9, Clear, 0, ⌫ (U+232B, a glyph)");
  for (const k of keys) {
    expectAll(k, ["h-[50px]", "rounded-[14px]", "border", "font-medium", "text-foreground", "hover:bg-muted", "active:bg-surface-3"], "a key");
  }
  expectAll(keys[0], ["text-[24px]", "border-border", "bg-card"], "a digit");
  expectAll(keys[9], ["text-[14px]", "border-transparent", "bg-transparent"], "Clear");
  expectAll(keys[11], ["text-[20px]", "border-transparent", "bg-transparent"], "⌫");
  assert.ok(keys[11].includes('aria-label="Delete last digit"'), "⌫ is named for a screen reader");
  expectAll(tagOf(html, "reveal-keys"), ["grid", "grid-cols-3", "gap-2"], "the key grid");
  expectAll(tagOf(html, "reveal-pin"), ["flex", "flex-col", "items-center", "gap-2.5"], "the PIN block");
  assert.ok(html.indexOf("Asha, enter your PIN") < html.indexOf('data-ui="reveal-dots"'), "the prompt above the dots");
  expectAll(tagOf(html, "reveal-dots"), ["flex", "justify-center", "gap-4"], "the dots row");
  const dots = html.match(/<span[^>]*data-filled[^>]*>/g) ?? [];
  assert.equal(dots.length, 4, "four dots");
  for (const d of dots) expectAll(d, ["size-3.5", "rounded-[50%]", "border-[1.5px]"], "a dot (the HTML's 50 %, not a 9999px pill)");
  expectAll(dots[0], ["border-foreground", "bg-foreground"], "a typed dot is ink");
  expectAll(dots[3], ["border-subtle-foreground"], "an empty dot rings in text-3");
  expectAll(tagOf(html, "reveal-message"), ["min-h-[18px]", "text-[13px]", "font-medium", "text-status-bad-ink"], "the message line");
  const wrong = renderToStaticMarkup(createElement(PinPad, { value: "", onChange: noop, onComplete: noop, size: "reveal", tones, error: "Incorrect PIN", errorCount: 1 }));
  for (const d of wrong.match(/<span[^>]*data-filled[^>]*>/g) ?? []) expectAll(d, ["border-destructive", "bg-status-bad-tint"], "a dot after a wrong PIN");
  expectAll(tagOf(wrong, "reveal-dots"), ["motion-safe:animate-html-shake"], "the dots shake after a wrong PIN");
  assert.match(wrong, /role="alert"[^>]*>Incorrect PIN</, "the message is an alert");
  assert.ok(!tagOf(html, "reveal-dots").includes("animate-html-shake"), "no shake before the first error");
  const css = readFileSync(path.join(HERE, "..", "app/globals.css"), "utf8");
  assert.ok(css.includes("--animate-html-shake: html-shake 0.42s ease;"), "the HTML's shake .42s ease");
  assert.match(css, /@keyframes html-shake \{[\s\S]*?20% \{\s*transform: translateX\(-9px\);[\s\S]*?40% \{\s*transform: translateX\(8px\);[\s\S]*?60% \{\s*transform: translateX\(-5px\);[\s\S]*?80% \{\s*transform: translateX\(3px\);/, "the HTML's shake keyframes");
});

test("the reveal dialog's panel (values 3.16): the 38px ink tile with the eye, 'Show sales figures' 17/600, the sub, the pad, Cancel", async () => {
  const { RevealPinPanel } = await import("@/components/dashboard/SalesReveal");
  const { Dialog } = await import("@/components/ui/dialog");
  const panel = (extra: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(Dialog, { open: true }, createElement(RevealPinPanel, { prompt: "Asha, enter your PIN", notice: null, pin: "", message: null, errorCount: 0, onChange: noop, onComplete: noop, onCancel: noop, ...extra })),
    );
  const html = panel();
  expectAll(tagOf(html, "reveal-head"), ["flex", "items-start", "gap-3"], "the header");
  expectAll(tagOf(html, "reveal-icon"), ["flex", "size-[38px]", "flex-none", "items-center", "justify-center", "rounded-[10px]", "bg-ink", "text-on-ink"], "the icon tile");
  assert.match(html, /<h2 [^>]*class="text-\[17px\] font-semibold"[^>]*>Show sales figures<\/h2>/, "the title");
  assert.match(html, /<p [^>]*class="mt-\[3px\] text-\[13\.5px\] leading-\[1\.45\] text-pretty text-muted-foreground"[^>]*>Sales stay visible on this device for 1 hour\. They hide again when the screen locks or you leave Dashboard\.<\/p>/, "the sub");
  assert.ok(html.includes('data-ui="reveal-keys"') && html.includes("Asha, enter your PIN"), "the pad and its prompt");
  expectAll(tagOf(html, "reveal-prompt"), ["text-[13px]", "text-muted-foreground"], "the prompt 13px text-2");
  const cancel = tagOf(html, "reveal-cancel");
  expectAll(cancel, ["h-10", "bg-transparent", "text-[14px]", "font-medium", "text-link"], "Cancel: a 40px link");
  assert.ok(!/\brounded-/.test(cancel), "values 3.16 gives Cancel no radius (fix 1)");
  assert.match(html, /data-ui="reveal-cancel"[^>]*>Cancel</, "Cancel");
  const none = panel({ notice: "Ask an admin to set your PIN to show sales." });
  assert.ok(none.includes("Ask an admin to set your PIN to show sales.") && !none.includes('data-ui="reveal-keys"'), "no PIN: the message instead of the keys");
  const blocked = panel({ notice: "This PIN is blocked after too many wrong tries. Ask an admin to unblock it." });
  assert.match(blocked, /data-ui="reveal-notice"[^>]*>This PIN is blocked after too many wrong tries\. Ask an admin to unblock it\.</, "a blocked PIN: its words instead of the keys");
  assert.ok(!blocked.includes('data-ui="reveal-keys"') && blocked.includes(">Cancel<"), "no keys, Cancel stays");
});

test("the page masks both cards with one reveal, and the reveal hides on a lock or when the page goes", () => {
  const page = readSrc(PAGE);
  assert.match(page, /const reveal = useSalesReveal\(user\?\.id \?\? null\);/, "one reveal for the signed-in person");
  assert.match(page, /<SalesHero\s+\{\.\.\.cards\}\s+shown=\{reveal\.shown\}\s+grow=\{grow\}\s+reveal=\{<SalesReveal reveal=\{reveal\} name=\{user\?\.name\} isAdmin=\{isAdmin\} \/>\}\s*\/>/, "the hero, masked by the reveal, with its controls");
  assert.match(page, /<BillBreakdown \{\.\.\.cards\} shown=\{reveal\.shown\} grow=\{grow\} \/>/, "the receipt, masked by the same reveal");
  assert.ok(!page.includes("<MoneyBreakdownCard"), "the reports' receipt is no longer on the dashboard");
  const src = readSrc("components/dashboard/SalesReveal.tsx");
  assert.ok(src.includes("SCREEN_LOCK_EVENT") && src.includes("LOCK_ATTR"), "a lock (asked for, or the idle cover) hides the figures and closes the dialog");
  assert.ok(src.includes("verifyOwnPin("), "the PIN is checked by the server (lib/pin-sign-in-client.ts verifyOwnPin)");
  assert.ok(src.includes("toast.success(REVEAL_TOAST)"), "the toast after a right PIN");
  assert.ok(src.includes("window.sessionStorage"), "the grant lives in sessionStorage");
  // Fix 1: the rules are lib/sales-reveal.ts revealReducer (tested there); every mount starts from REVEAL_START (hidden).
  assert.ok(src.includes("useReducer(revealReducer, REVEAL_START)"), "shown starts false on every mount: leaving the dashboard hides the figures");
  assert.ok(src.includes('dispatch({ type: "lock" })') && src.includes('dispatch({ type: "expire", now: at })'), "a lock and the hour's end go through the reducer");
  assert.ok(src.includes("checkOwnPin()") && src.includes("revealNotice(gate, isAdmin)"), "the dialog asks once whether the keys can help, and shows the words instead when not");
  assert.ok(src.includes("HTML_PRESS_CLASS"), "the button, the keys and Cancel press like the HTML's");
});

// ── Needs attention ─────────────────────────────────────────────────────────

const LIVE: DashboardLive = {
  openTabs: { count: 2, value: 1450 },
  pendingRequests: 1,
  dues: { total: 8450, customers: 6 },
  unavailable: { count: 3, names: ["Cold coffee", "Brownie"] },
  bookingsToday: 4,
};

// U0 match (Task 5, design 5.5): our five live items in the HTML's chip — a bold part, the rest, an action pill and a
// status dot — in our order (requests first).
test("attentionItems maps our five live counts onto the HTML's chip: strong, rest, action, dot and link", () => {
  const items = attentionItems(LIVE);
  const expected = [
    { key: "requests", kind: "warn", strong: "1 QR order", rest: "waiting", action: "View", href: "/requests" },
    { key: "tabs", kind: "info", strong: "2 open tabs", rest: "· ₹1,450", action: "Open", href: "/orders?payment=Unpaid&status=Pending" },
    { key: "bookings", kind: "reserved", strong: "4 bookings", rest: "today", action: "View", href: "/reservations" },
    {
      key: "unavailable",
      kind: "bad",
      strong: "3 items",
      rest: "unavailable",
      action: "View",
      href: menuItemsHref({ status: "out-of-stock" }),
      title: "Cold coffee, Brownie and 1 more",
    },
    { key: "dues", kind: "bill", strong: "₹8,450 due", rest: "from 6 customers", action: "Collect", href: "/customers" },
  ];
  assert.equal(items.length, expected.length, "five items when every count is non-zero");
  expected.forEach((want, i) => assert.deepEqual(items[i], want, `item ${i + 1}: ${want.strong} ${want.rest} · ${want.action}`));
  const none = attentionItems({ openTabs: { count: 0, value: 0 }, pendingRequests: 0, dues: { total: 0, customers: 0 }, unavailable: { count: 0, names: [] }, bookingsToday: 0 });
  assert.deepEqual(none, [], "nothing at zero");
  assert.deepEqual(
    attentionItems({ ...LIVE, pendingRequests: 2, unavailable: { count: 2, names: ["Tea", "Cake"] } }).map((i) => [i.strong, i.title]),
    [["2 QR orders", undefined], ["2 open tabs", undefined], ["4 bookings", undefined], ["2 items", "Tea, Cake"], ["₹8,450 due", undefined]],
    "plurals, and no 'and N more' when every name is listed",
  );
});

const classesOf = (html: string, dataUi: string, nth = 0): string[] => {
  const tags = html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${dataUi}"[^>]*>`, "g")) ?? [];
  return (/class="([^"]*)"/.exec(tags[nth] ?? "")?.[1] ?? "").split(" ");
};
const hasAll = (classes: string[], wanted: string[], what: string) => {
  for (const c of wanted) assert.ok(classes.includes(c), `${what} has ${c} (got: ${classes.join(" ")})`);
};

test("AttentionStrip: the HTML's wide row (label, 34px chips with a 24px action pill) and phone card, as links in our order", () => {
  const html = renderToStaticMarkup(createElement(AttentionStrip, { live: LIVE, loading: false, isError: false }));
  assert.ok(html.includes('aria-label="Needs attention"'), "the section keeps its name");
  assert.ok(!html.includes("pointer-coarse"), "ruling R1: the HTML's sizes on touch screens too");

  // values 3.1 wide row: shown from cw 560 (the HTML's attWide), a label, then the chips.
  hasAll(classesOf(html, "attention-wide"), ["hidden", "@min-[560px]:flex", "flex-wrap", "items-center", "gap-2"], "the wide row");
  hasAll(
    classesOf(html, "attention-label"),
    ["flex", "items-center", "gap-[7px]", "text-[11.5px]", "font-semibold", "tracking-[0.07em]", "uppercase", "text-muted-foreground", "mr-1"],
    "the Needs attention label",
  );
  hasAll(
    classesOf(html, "attention-chip"),
    ["flex", "items-center", "gap-[9px]", "h-[34px]", "pl-3", "pr-[5px]", "border", "border-border", "rounded-[17px]", "bg-card", "text-foreground", "text-[13px]", "whitespace-nowrap", "hover:border-subtle-foreground", ...HTML_PRESS_CLASS.split(" ")],
    "a chip",
  );
  hasAll(
    classesOf(html, "attention-pill"),
    ["flex", "items-center", "h-6", "px-2.5", "rounded-[12px]", "bg-surface-3", "text-[12px]", "font-semibold"],
    "a chip's action pill",
  );
  assert.ok(html.includes('<b class="font-semibold">1 QR order</b> waiting'), "the bold part, a space, the rest");

  const chips: Array<[string, string, string]> = [
    ["1 QR order", "/requests", "View"],
    ["2 open tabs", "/orders?payment=Unpaid&amp;status=Pending", "Open"],
    ["4 bookings", "/reservations", "View"],
    ["3 items", menuItemsHref({ status: "out-of-stock" }).replace(/&/g, "&amp;"), "View"],
    ["₹8,450 due", "/customers", "Collect"],
  ];
  let last = -1;
  for (const [strong, href, action] of chips) {
    const at = html.indexOf(`>${strong}</b>`);
    assert.ok(at > last, `"${strong}" is shown, after the chip before it`);
    const link = html.lastIndexOf("<a ", at);
    assert.ok(html.slice(link, at).includes(`href="${href}"`), `"${strong}" links to ${href}`);
    assert.ok(html.slice(at, html.indexOf("</a>", at)).includes(`>${action}</span>`), `"${strong}" carries its ${action} pill`);
    assert.equal(html.split(`href="${href}"`).length - 1, 2, `${href} is linked twice: the wide chip and the phone row`);
    last = at;
  }
  assert.ok(html.includes('title="Cold coffee, Brownie and 1 more"'), "the unavailable chip names the items");
  for (const dot of ["bg-status-warn", "bg-status-info", "bg-status-reserved", "bg-status-bad", "bg-status-bill"]) {
    assert.ok(html.includes(dot), `a ${dot} dot marks its chip`);
  }

  // values 3.1 phone card: below cw 560 (attMob), closed by default.
  hasAll(
    classesOf(html, "attention-card"),
    ["flex", "@min-[560px]:hidden", "flex-col", "overflow-hidden", "rounded-[12px]", "border", "border-border", "bg-card"],
    "the phone card",
  );
  hasAll(classesOf(html, "attention-toggle"), ["flex", "h-12", "w-full", "min-w-0", "items-center", "gap-2.5", "px-3", "text-left", ...HTML_PRESS_CLASS.split(" ")], "the card's toggle (with the HTML's press)");
  hasAll(
    classesOf(html, "attention-count"),
    ["flex", "size-7", "shrink-0", "items-center", "justify-center", "rounded-[8px]", "bg-status-warn-tint", "text-status-warn-ink", "text-[13px]", "font-bold"],
    "the count tile",
  );
  assert.match(html, /aria-expanded="false"[^>]*>[\s\S]*?>5<[\s\S]*?Needs attention/, "the phone's row says 5 · Needs attention");
  assert.ok(html.includes(">1 QR order · 2 open tabs · 4 bookings · 3 items · ₹8,450 due</span>"), "the peek joins the bold parts with ' · '");
  hasAll(classesOf(html, "attention-peek"), ["block", "truncate", "text-[12px]", "text-muted-foreground"], "the peek line");
  const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
  assert.ok(controls, "the disclosure button names the list it opens");
  assert.ok(html.includes(`<ul id="${controls}" hidden=""`), "aria-controls equals the list's id, and it starts folded");
  hasAll(classesOf(html, "attention-list"), ["flex", "flex-col", "border-t", "border-border-2"], "the open list");
  hasAll(classesOf(html, "attention-item"), ["flex", "min-h-[46px]", "items-center", "gap-2.5", "px-3", "py-2", "text-left", "text-[13px]", "text-foreground", ...HTML_PRESS_CLASS.split(" ")], "a row (with the HTML's press)");
  assert.ok(!classesOf(html, "attention-item", 0).includes("border-t"), "the first row has no rule");
  hasAll(classesOf(html, "attention-item", 1), ["border-t", "border-border-2"], "the next rows' rule");
  hasAll(
    classesOf(html, "attention-item-action"),
    ["flex", "h-7", "flex-none", "items-center", "rounded-[8px]", "px-[11px]", "bg-surface-3", "text-[12px]", "font-semibold"],
    "a row's action",
  );
  hasAll(classesOf(html, "attention-item-dot"), ["mx-2.5"], "a row's dot (margin 0 10px)");
  // values 3.1: the chevron turns with transition: transform .2s (the default ease), as a transform.
  assert.match(
    html,
    /<svg[^>]*class="[^"]*\bmotion-safe:\[transition:transform_\.2s_ease\] \[transform:rotate\(0deg\)\][^"]*"/,
    "the closed chevron: rotate(0deg), turning in .2s ease",
  );
});

test("AttentionStrip: loading, error and all clear in the same language", () => {
  const loading = renderToStaticMarkup(createElement(AttentionStrip, { loading: true, isError: false }));
  const chips = loading.match(/<div aria-hidden="true" class="[^"]*h-\[34px\][^"]*"/g) ?? [];
  assert.equal(chips.length, 3, "three chip skeletons");
  for (const chip of chips) {
    for (const cls of ["rounded-[17px]", "bg-surface-3", "motion-safe:animate-pulse"]) assert.ok(chip.includes(cls), `a chip skeleton has ${cls}`);
  }
  assert.ok(!loading.includes("All clear") && !loading.includes("pointer-coarse"), "skeletons while the counts load, the HTML's size on touch");

  const clear = renderToStaticMarkup(
    createElement(AttentionStrip, {
      live: { openTabs: { count: 0, value: 0 }, pendingRequests: 0, dues: { total: 0, customers: 0 }, unavailable: { count: 0, names: [] }, bookingsToday: 0 },
      loading: false,
      isError: false,
    }),
  );
  assert.match(clear, /<p class="[^"]*text-\[13px\] text-muted-foreground[^"]*">[\s\S]*?All clear — nothing needs attention right now\.<\/p>/, "the all-clear line, 13px text-2");
  assert.ok(!clear.includes("aria-expanded"), "nothing to fold when nothing needs attention");
  const failed = renderToStaticMarkup(createElement(AttentionStrip, { loading: false, isError: true }));
  assert.match(failed, /<p class="text-\[13px\] text-muted-foreground">Couldn(?:&#x27;|')t load the live counts\. Trying again…<\/p>/, "the error line, 13px text-2");
});

// ── the period picker ───────────────────────────────────────────────────────

// sha256 of the default RangeBar's markup, captured from the code before U0 match Task 5.
const RANGE_BAR_SHA256 = {
  admin7d: "15cf5e4db57c503e5f7b9fa79abe732bbbb412a7b71111dac02e825b2b651550",
  staffToday: "65e3b5003093e38ad3479688417aee529163f166b5b7c421f24987c495fba0b9",
};

test("RangeBar's default look (reports, expenses): the Period group, its words and one pressed choice, 44 px on touch", () => {
  const admin = renderToStaticMarkup(
    createElement(RangeBar, { value: { preset: "7d", range: presetRange("7d") }, onChange: noop, isAdmin: true }),
  );
  assert.ok(admin.includes('role="group"') && admin.includes('aria-label="Period"'), "the Period group");
  const buttons = admin.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
  assert.deepEqual(
    buttons.map((b) => />([^<]*)</.exec(b)?.[1]),
    ["Today", "Yesterday", "7 days", "30 days", "Custom"],
    "the admin presets, in order",
  );
  assert.equal((admin.match(/aria-pressed="true"/g) ?? []).length, 1, "one choice pressed");
  assert.match(admin, /aria-pressed="true"[^>]*>7 days</, "the pressed one is 7 days");
  const group = /<div role="group"[^>]*>/.exec(admin)?.[0] ?? "";
  assert.ok(group.includes("bg-track"), "the track (--track)");
  const chosen = buttons.find((b) => b.includes('aria-pressed="true"')) ?? "";
  assert.ok(chosen.includes("bg-card") && chosen.includes("shadow-sm"), "the chosen segment is white with a small lift");
  assert.ok(buttons.every((b) => b.includes("pointer-coarse:h-11")), "every segment is 44 px on a touch screen");
  const staff = renderToStaticMarkup(
    createElement(RangeBar, { value: { preset: "today", range: presetRange("today") }, onChange: noop, isAdmin: false }),
  );
  assert.deepEqual(
    (staff.match(/<button[^>]*>[^<]*<\/button>/g) ?? []).map((b) => />([^<]*)</.exec(b)?.[1]),
    ["Today", "Yesterday", "Pick a day"],
    "staff see one day at a time",
  );
  // The reports and expenses keep this look byte for byte (U0 match Task 5 gave the dashboard its own variant).
  assert.equal(sha256(admin), RANGE_BAR_SHA256.admin7d, "the default RangeBar (admin, 7 days) renders exactly what it rendered before Task 5");
  assert.equal(sha256(staff), RANGE_BAR_SHA256.staffToday, "the default RangeBar (staff, today) renders exactly what it rendered before Task 5");
});

test("RangeBar variant 'dashboard': the HTML's segmented control (values 3.2, SEG_ON / SEG_OFF), our presets", () => {
  const admin = renderToStaticMarkup(
    createElement(RangeBar, { variant: "dashboard", value: { preset: "today", range: presetRange("today") }, onChange: noop, isAdmin: true }),
  );
  assert.ok(admin.includes('role="group"') && admin.includes('aria-label="Period"'), "the Period group");
  assert.ok(!admin.includes("pointer-coarse"), "ruling R1: the HTML's 36px track on touch screens too");
  hasAll(classesOf(admin, "period-track"), ["flex", "h-9", "gap-0.5", "rounded-[9px]", "bg-surface-3", "p-[3px]", "max-w-full", "overflow-x-auto"], "the track");
  const buttons = admin.match(/<button[\s\S]*?<\/button>/g) ?? [];
  const words = (b: string) => b.replace(/<[^>]+>/g, "");
  assert.deepEqual(buttons.map(words), ["Today", "Yesterday", "7 days", "30 days", "Custom"], "the HTML's four, then our Custom (admin)");
  buttons.forEach((b, i) => {
    const classes = /class="([^"]*)"/.exec(b)?.[1].split(" ") ?? [];
    assert.ok(b.includes('data-ui="period-button"'), `button ${i + 1} is a period button`);
    hasAll(classes, ["rounded-[7px]", "text-[13px]", "whitespace-nowrap", ...HTML_PRESS_CLASS.split(" ")], `button ${i + 1} (with the HTML's press)`);
    assert.ok(!classes.some((c) => /^h-/.test(c)), `button ${i + 1} stretches to the track (30px) as the HTML's`);
    if (i === 0) hasAll(classes, ["bg-seg", "[box-shadow:var(--seg-sh)]", "text-foreground", "font-semibold"], "the chosen segment (SEG_ON: the HTML's exact seg-sh, text, 600)");
    else hasAll(classes, ["bg-transparent", "text-muted-foreground", "font-medium"], `segment ${i + 1} (SEG_OFF, text-2, 500)`);
    if (i < 4) hasAll(classes, ["px-3"], `segment ${i + 1}: padding 0 12px`);
  });
  // Ruling R10: under cw 560 our fifth segment is a calendar glyph in 0 10px, so the admin's track fits a 360px phone.
  const custom = buttons[4] ?? "";
  assert.ok(custom.includes('aria-label="Custom"') && custom.includes('aria-pressed="false"'), "Custom keeps its name and state");
  hasAll(/class="([^"]*)"/.exec(custom)?.[1].split(" ") ?? [], ["px-2.5", "@min-[560px]:px-3"], "Custom: 0 10px as a glyph, 0 12px as a word");
  assert.match(custom, /<svg[^>]*class="[^"]*\bblock size-\[15px\] @min-\[560px\]:hidden\b[^"]*"/, "the glyph, under cw 560 only");
  assert.ok(custom.includes('<span class="hidden @min-[560px]:inline">Custom</span>'), "the word, from cw 560");
  const staff = renderToStaticMarkup(
    createElement(RangeBar, { variant: "dashboard", value: { preset: "today", range: presetRange("today") }, onChange: noop, isAdmin: false }),
  );
  assert.deepEqual((staff.match(/<button[\s\S]*?<\/button>/g) ?? []).map(words), ["Today", "Yesterday", "Pick a day"], "staff: one day at a time");
  assert.ok(!staff.includes("<svg"), "staff's three words fit: no glyph");
});

// ── the generic card ────────────────────────────────────────────────────────

// sha256 of DashCard's default (reports) markup, captured from the code before U0 match Task 5.
const DASH_CARD_SHA256: Record<string, string> = {
  loading: "959100ed443468bfb0fa3578a0ada35e396cbff1f96566182321ef54f41ebae7",
  error: "24dee05bd4dfb69d63ae920c34fbf71a625ee6086ecd54b82fa1c7302d76ffb6",
  ready: "a04a0c06232857ec9ea0961b5264b397cfc997f041525b6908b12b10b69d814e",
  empty: "9ec7b81e5d564dc45d015671675358b4e5016654ef8bf4f81369a118dc17045f",
  updating: "e477d737edc6e590bc6cfc9d776262e841047496cd4a49828739b3e69961f3c7",
};
const CARD_BASE = { title: "Sales", period: "Today · vs Mon", link: { href: "/x", label: "View all" }, bodyMinHeight: 120, onRetry: noop };
const card = (props: Partial<React.ComponentProps<typeof DashCard>>) =>
  renderToStaticMarkup(createElement(DashCard, { ...CARD_BASE, status: "ready", ...props }, createElement("p", null, "body")));

test("DashCard's default look (the reports pages) renders exactly what it rendered before Task 5", () => {
  assert.equal(sha256(card({ status: "loading" })), DASH_CARD_SHA256.loading, "loading");
  assert.equal(sha256(card({ status: "error" })), DASH_CARD_SHA256.error, "error");
  assert.equal(sha256(card({ status: "ready" })), DASH_CARD_SHA256.ready, "ready");
  assert.equal(
    sha256(renderToStaticMarkup(createElement(DashCard, { ...CARD_BASE, status: "empty", empty: { title: "None", description: "Nothing yet." } }))),
    DASH_CARD_SHA256.empty,
    "empty",
  );
  assert.equal(sha256(card({ updating: true, bodyClassName: "min-h-[500px]", className: "lg:col-span-2" })), DASH_CARD_SHA256.updating, "updating");
});

test("DashCard variant 'dashboard': the HTML's generic card (values 3.0) and its states in the same language", () => {
  const ready = card({ variant: "dashboard", className: "@min-[680px]:col-span-full" });
  hasAll(
    classesOf(ready, "dash-card"),
    ["min-w-0", "rounded-[14px]", "border", "border-border", "bg-card", "px-5", "py-[18px]", "leading-[normal]", "text-foreground", "@min-[680px]:col-span-full"],
    "the card (surface, 1px border, radius 14, padding 18px 20px)",
  );
  assert.ok(ready.startsWith('<section aria-labelledby="dash-sales"'), "a section named by its title");
  hasAll(classesOf(ready, "dash-card-head"), ["flex", "items-start", "justify-between", "gap-3"], "the head");
  hasAll(classesOf(ready, "dash-card-title"), ["text-[15px]", "font-semibold"], "the title 15/600");
  hasAll(classesOf(ready, "dash-card-sub"), ["mt-[3px]", "text-[12.5px]", "text-subtle-foreground"], "the subtitle 12.5 text-3, 3px under");
  hasAll(classesOf(ready, "dash-card-link"), ["shrink-0", "whitespace-nowrap", "text-[13px]", "font-medium", "text-link"], "the header link 13/500 link");
  assert.match(ready, /data-ui="dash-card-link"[^>]*href="\/x"[^>]*>View all →<\/a>|href="\/x"[^>]*data-ui="dash-card-link"[^>]*>View all →<\/a>/, "the link reads 'View all →'");
  assert.ok(!/brand-|leading-tight/.test(ready), "no Paper & Ink token or tight leading left in the dashboard card");

  const loading = card({ variant: "dashboard", status: "loading" });
  assert.match(
    loading,
    /<div style="height:120px" class="flex mt-3\.5"><div aria-hidden="true" class="rounded-md bg-surface-3 motion-safe:animate-pulse w-full"><\/div><\/div>/,
    "the skeleton keeps the reserved height, 14px under the head, on surface-3",
  );
  assert.ok(ready.includes('<div style="min-height:120px" class="transition-opacity duration-200 mt-3.5">'), "the body sits 14px under the head (the HTML's most common gap)");
  const error = card({ variant: "dashboard", status: "error" });
  assert.ok(error.includes('<p class="text-[13px] text-muted-foreground">Couldn&#x27;t load this. It will try again on its own.</p>'), "the error line 13px text-2");
  hasAll(classesOf(error, "dash-card-retry"), ["h-[30px]", "rounded-[8px]", "border", "border-border", "bg-card", "px-[11px]", "text-[12.5px]", "font-medium"], "Try again as the HTML's small outline button");
  const empty = renderToStaticMarkup(
    createElement(DashCard, { ...CARD_BASE, variant: "dashboard", status: "empty", empty: { title: "None", description: "Nothing yet." } }),
  );
  // Task 8: the HTML's one empty state (values 3.7: padding 24px 0, centred, 13px text-3) with our words, in the body
  // that still holds the reserved height.
  // Fix round 1: ONE line (our title) right under the head, top-aligned; the reserved height stays below it.
  assert.ok(
    empty.includes('<div style="min-height:120px" class="mt-3.5"><p data-ui="dash-empty" class="py-6 text-center text-[13px] text-subtle-foreground">None</p></div>'),
    "the empty state: our title as the HTML's one 13px text-3 line, 24px above and below, centred, at the top of the reserved body",
  );
  assert.ok(!empty.includes("Nothing yet."), "no second line on the dashboard (the HTML's empty state is one line)");
  assert.ok(card({ variant: "dashboard", updating: true }).includes("opacity-55"), "the old range's body dims while the new one loads");
  // Fix round 1: each card sets its own space under the head (values 3.5–3.14), 14px unless it says otherwise.
  for (const [gap, cls] of [[8, "mt-2"], [10, "mt-2.5"], [14, "mt-3.5"], [18, "mt-[18px]"]] as const) {
    const body = card({ variant: "dashboard", bodyGap: gap });
    assert.ok(body.includes(`<div style="min-height:120px" class="transition-opacity duration-200 ${cls}">`), `bodyGap ${gap} puts the body ${gap}px under the head`);
    const waiting = card({ variant: "dashboard", status: "loading", bodyGap: gap });
    assert.ok(waiting.includes(`<div style="height:120px" class="flex ${cls}">`), `the skeleton holds the same ${gap}px`);
  }
  assert.ok(readSrc("components/dashboard/RecentOrders.tsx").includes("bodyGap={10}"), "Recent orders: the list 10px under the head (values 3.7)");
  assert.ok(readSrc("components/dashboard/TodayReservations.tsx").includes("bodyGap={10}"), "Today's reservations: 10px (values 3.8)");
  assert.match(readSrc("components/dashboard/RangeCards.tsx"), /title="Top items"[\s\S]{0,200}bodyGap=\{8\}/, "Top items: 8px (values 3.12)");
});

// ── the receipt ─────────────────────────────────────────────────────────────

test("MoneyBreakdownCard is a receipt: every line with a dotted leader, the net, a zig-zag edge from a CSS mask", () => {
  const src = readSrc("components/reports/MoneyBreakdownCard.tsx");
  assert.ok(src.includes("<CardDescription"), "landmark: the caption renders through <CardDescription>");
  assert.ok(!src.includes("<p " + "className"), "no raw <p className> caption (its existing pin)");
  assert.ok(!src.includes("@" + "property"), "no @property (WebView 109)");

  const money = { gross: 52000, discount: 1500, reward: 400, gst: 2400, charges: 750 };
  const html = renderToStaticMarkup(createElement(MoneyBreakdownCard, { money, net: 53250, caption: "Completed orders · Today" }));
  assert.ok(html.includes("Bill breakdown") && html.includes("Completed orders · Today"), "title and caption");
  let last = -1;
  for (const line of MONEY_BREAKDOWN_LINES) {
    const at = html.indexOf(line.label);
    assert.ok(at > last, `"${line.label}" is on the receipt, in order`);
    last = at;
  }
  for (const amount of ["₹52,000", "- ₹1,500", "- ₹400", "+ ₹2,400", "+ ₹750"]) {
    assert.ok(html.includes(amount), `the line amount ${amount}`);
  }
  assert.ok(html.indexOf(MONEY_NET_LABEL) > last && html.includes("₹53,250"), "the net line closes the receipt");
  assert.equal((html.match(/border-dotted/g) ?? []).length, MONEY_BREAKDOWN_LINES.length, "a dotted leader on every line");
  assert.ok(html.includes("-webkit-mask:") && html.includes("conic-gradient") && html.includes("repeat-x"), "the zig-zag edge is a prefixed CSS mask of a repeated gradient");
  const loading = renderToStaticMarkup(createElement(MoneyBreakdownCard, { net: 0, loading: true, caption: "Completed orders · Today" }));
  assert.ok(!loading.includes("₹"), "no amounts while loading");
});

// ── category and status colours (Task 19) ────────────────────────────────────

test("the cards take their colours from the one palette, with no raw Tailwind palette left", () => {
  const cards = readSrc("components/dashboard/RangeCards.tsx");
  assert.ok(cards.includes("PAYMENT_KIND") && cards.includes("CHANNEL_KIND"), "payment mix and channels use PAYMENT_KIND / CHANNEL_KIND");
  const raw = /-(blue|green|gray|red|yellow|purple|orange|slate)-[0-9]/;
  // U0 match Task 8: their pills are the HTML's (DASH_PILL_CLASS, 24px radius 12 12/600), not StatusPill's look; the
  // colours still come from the one palette (STATUS_CLASSES).
  for (const f of ["TodayReservations", "RecentOrders"]) {
    const src = readSrc(`components/dashboard/${f}.tsx`);
    assert.ok(!raw.test(src), `${f} has no raw palette class`);
    assert.ok(src.includes("DASH_PILL_CLASS") && src.includes("STATUS_CLASSES["), `${f} draws the HTML's pill in the palette's colours`);
  }
  assert.ok(readSrc("components/dashboard/RecentOrders.tsx").includes("PAY_PILL_KIND"), "recent orders pills use PAY_PILL_KIND");
  assert.ok(readSrc("components/dashboard/TodayReservations.tsx").includes("RESERVATION_KIND"), "reservations use RESERVATION_KIND");
  const floor = readSrc("components/dashboard/LiveFloorPanel.tsx");
  assert.ok(floor.includes("TABLE_STATUS_META") && !/bg-(green|red|amber)-500/.test(floor), "the floor panel keeps TABLE_STATUS_META");
});

// ── How guests paid, Where orders came from (U0 match Task 8, values 3.9, 3.10, ruling R17) ─────────────────────────

const PAY_ROWS: DashboardData["payments"] = [
  { key: "Cash", label: "Cash", count: 3, amount: 600, share: 0.6 },
  { key: "Online", label: "Online", count: 1, amount: 400, share: 0.4 },
  { key: "Due", label: "Due", count: 2, amount: 0, share: 0 },
];

test("PaymentMixCard: the HTML's How guests paid - the 24px mono total, the 10px bar on surface-3, swatch rows, the dues note", async () => {
  const { PaymentMixCard } = await import("@/components/dashboard/RangeCards");
  const pay = renderToStaticMarkup(createElement(PaymentMixCard, ready({ payments: PAY_ROWS })));
  assert.ok(tagOf(pay, "pay-card").startsWith("<section"), "the card names itself for the probes (data-ui pay-card)");
  assert.ok(pay.includes(">How guests paid</h2>") && pay.includes(">Today · money collected</p>"), "the HTML's title, the period's sub (ruling R17)");
  assert.ok(!pay.includes('data-ui="dash-card-link"'), "no header link (values 3.9)");
  assert.ok(pay.includes('class="transition-opacity duration-200 mt-3.5"'), "the total 14px under the head");
  expectAll(tagOf(pay, "pay-total"), ["font-mono", "text-[24px]", "font-medium", "tracking-[-0.03em]"], "the total: Geist Mono 24/500, -0.03em");
  assert.deepEqual(textsOf(pay, "pay-total"), ["₹1,000"], "the money collected");
  expectAll(tagOf(pay, "pay-bar"), ["mt-3", "flex", "h-2.5", "gap-0.5", "overflow-hidden", "rounded-[5px]", "bg-surface-3"], "the bar: 10px, radius 5, 2px apart, 12px under the total, on surface-3");
  const segs = allTags(pay, "pay-seg");
  assert.equal(segs.length, 2, "one segment per mode with a share (a zero share draws none)");
  expectAll(segs[0], ["bg-status-ok", "origin-left", "motion-safe:animate-grow-x"], "Cash's segment in --ok, growing from the left");
  expectAll(segs[1], ["bg-status-info", "origin-left", "motion-safe:animate-grow-x"], "Online's in --info (the HTML's UPI accent)");
  assert.ok(segs[0].includes('style="width:60%"') && segs[1].includes('style="width:40%"'), "each segment as wide as its share");
  expectAll(tagOf(pay, "pay-list"), ["mt-2.5", "flex", "flex-col"], "the rows 10px under the bar");
  const rows = allTags(pay, "pay-row");
  assert.equal(rows.length, 3, "a row per mode");
  for (const r of rows) expectAll(r, ["flex", "items-center", "gap-2.5", "border-t", "border-border-2", "py-2", "text-[13.5px]"], "a row: 8px 0 over a border-2 rule, 13.5px, 10 apart");
  assert.ok(
    pay.includes('<span data-ui="pay-swatch" aria-hidden="true" class="size-[9px] shrink-0 rounded-[3px] bg-status-ok"></span><span class="flex-1">Cash <span class="text-subtle-foreground">· 3 orders</span></span><span data-ui="pay-amount" class="font-mono font-semibold">₹600</span><span data-ui="pay-pct" class="w-9 text-right text-[12px] text-subtle-foreground">60%</span>'),
    "the 9px radius-3 swatch, '{mode} · {n} orders', the mono 600 amount, the 36px share in 12px text-3",
  );
  assert.ok(pay.includes("Online <span class=\"text-subtle-foreground\">· 1 order</span>"), "one order is singular");
  expectAll(tagOf(pay, "pay-note"), ["mt-1.5", "text-[12px]", "text-subtle-foreground", "text-pretty"], "the note 6px under the rows, 12px text-3");
  assert.deepEqual(textsOf(pay, "pay-note"), ["Due bills count only what was paid so far — the rest sits in customer dues."], "the HTML's sentence when a Due row has orders (ruling R17)");
  const noDue = renderToStaticMarkup(createElement(PaymentMixCard, ready({ payments: PAY_ROWS.slice(0, 2) })));
  assert.ok(!noDue.includes('data-ui="pay-note"'), "no note without a Due or Credit bill");
  assert.ok(!/brand-|RankedList|h-1\.5/.test(pay), "no Paper & Ink token or ranked-list bar left");
});

test("ChannelsCard: the HTML's Where orders came from - bordered rows of a 34px tile, the label and a 4px bar, the amount and share", async () => {
  const { ChannelsCard } = await import("@/components/dashboard/RangeCards");
  const ch = renderToStaticMarkup(
    createElement(ChannelsCard, ready({
      channels: [
        { key: "dine-in", label: "Dine-in", count: 3, amount: 600, share: 0.6 },
        { key: "takeaway", label: "Takeaway", count: 1, amount: 250, share: 0.25 },
        { key: "qr", label: "QR self-order", count: 1, amount: 100, share: 0.1 },
        { key: "counter", label: "Counter", count: 1, amount: 50, share: 0.05 },
      ],
    })),
  );
  assert.ok(tagOf(ch, "src-card").startsWith("<section"), "the card names itself (data-ui src-card)");
  assert.ok(ch.includes(">Where orders came from</h2>") && ch.includes(">Today · completed orders</p>"), "the HTML's title and sub pattern");
  expectAll(tagOf(ch, "src-list"), ["flex", "flex-col", "gap-2"], "the rows 8px apart");
  assert.ok(ch.includes('class="transition-opacity duration-200 mt-3.5"'), "the list 14px under the head");
  const rows = allTags(ch, "src-row");
  assert.equal(rows.length, 4, "our four channels");
  for (const r of rows) {
    expectAll(r, ["grid", "grid-cols-[34px_minmax(0,1fr)_auto]", "items-center", "gap-3", "rounded-[12px]", "border", "border-border-2", "px-3", "py-2.5"], "a row: 34px | 1fr | auto, gap 12, 10px 12px, a border-2 box, radius 12");
  }
  const tiles = allTags(ch, "src-tile");
  for (const t of tiles) expectAll(t, ["flex", "size-[34px]", "items-center", "justify-center", "rounded-[9px]"], "a 34px tile, radius 9");
  expectAll(tiles[0], ["bg-status-info-tint", "text-status-info-ink"], "dine-in: info-t / info-i");
  expectAll(tiles[1], ["bg-status-warn-tint", "text-status-warn-ink"], "takeaway: warn-t / warn-i");
  expectAll(tiles[2], ["bg-status-reserved-tint", "text-status-reserved-ink"], "QR: res-t / res-i");
  expectAll(tiles[3], ["bg-status-ok-tint", "text-status-ok-ink"], "counter: ok-t / ok-i");
  // Fix round 1: Dine-in and Takeaway take the HTML's glyphs (values 5, the table and the bag); our QR and counter keep
  // lucide's QrCode and Store (the HTML has neither), all at 16px with a 1.8 stroke.
  assert.deepEqual(rows.map((r) => /data-channel="([^"]+)"/.exec(r)?.[1]), ["dine-in", "takeaway", "qr", "counter"], "each row names its channel");
  const glyphs = (ch.match(/<svg[^>]*>/g) ?? []).filter(
    (t) => /^<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/.test(t),
  );
  assert.equal(glyphs.length, 2, "two of the HTML's inline glyphs, 16px, stroke 1.8, round caps and joins");
  assert.ok(ch.includes('<path d="M3 11h18M12 11v9M7 20h10M6 11V5M18 11V5"></path>'), "Dine-in: the HTML's table");
  assert.ok(ch.includes('<path d="M6 7h12l-1 13H7zM9 7a3 3 0 0 1 6 0"></path>'), "Takeaway: the HTML's bag");
  const icons = (ch.match(/<svg[^>]*>/g) ?? []).filter((t) => t.includes('stroke-width="1.8"') && /class="lucide[^"]*\bsize-4\b/.test(t));
  assert.equal(icons.length, 2, "QR and counter: our icons at 16px, stroke 1.8");
  assert.ok(ch.includes("lucide-qr-code") && ch.includes("lucide-store"), "QrCode and Store");
  assert.ok(!/lucide-utensils|lucide-shopping-bag/.test(ch), "no lucide glyph where the HTML has its own");
  assert.ok(
    ch.includes('<span data-ui="src-label" class="block text-[13.5px] font-medium">Dine-in <span class="font-normal text-subtle-foreground">· 3 orders</span></span>'),
    "'{channel} · {n} orders' in 13.5/500, the count in 400 text-3",
  );
  expectAll(tagOf(ch, "src-track"), ["mt-[7px]", "block", "h-1", "overflow-hidden", "rounded-[2px]", "bg-surface-3"], "the 4px track, 7px under the label");
  const fills = allTags(ch, "src-fill");
  expectAll(fills[0], ["block", "h-full", "rounded-[2px]", "bg-status-info", "origin-left", "motion-safe:animate-grow-x"], "the fill in the channel's colour, growing in");
  assert.ok(fills[0].includes('style="width:60%"') && fills[3].includes('style="width:5%"'), "each fill as wide as its share of the sales");
  expectAll(tagOf(ch, "src-amount"), ["block", "font-mono", "text-[13.5px]", "font-semibold"], "the amount: mono 600 13.5");
  expectAll(tagOf(ch, "src-pct"), ["block", "text-[11.5px]", "text-subtle-foreground"], "the share: 11.5 text-3");
  assert.deepEqual(textsOf(ch, "src-amount"), ["₹600", "₹250", "₹100", "₹50"], "the amounts");
  assert.deepEqual(textsOf(ch, "src-pct"), ["60%", "25%", "10%", "5%"], "the shares");
});

test("PaymentMixCard and ChannelsCard reserve their loaded heights, and mixSegments handles zero, one mode and rounding", async () => {
  const { MIX_HEADER_PX, PAY_ROW_PX, PAYMENT_BODY_MIN_PX, CHANNEL_BODY_PX, mixSegments } = await import("@/components/dashboard/RangeCards");
  assert.equal(MIX_HEADER_PX, 31 + 12 + 10 + 10, "the 31px total, 12px, the 10px bar, 10px to the rows");
  assert.equal(PAY_ROW_PX, 35, "a row: 16px of padding, the 18px line, its 1px rule");
  assert.equal(PAYMENT_BODY_MIN_PX, 3 * PAY_ROW_PX + MIX_HEADER_PX, "the reserved body height includes the header, so loading and empty hold the loaded height");
  assert.equal(CHANNEL_BODY_PX, 3 * 56 + 2 * 8, "three 56px rows 8px apart");
  assert.ok(readSrc("components/dashboard/RangeCards.tsx").includes("bodyMinHeight={PAYMENT_BODY_MIN_PX}"), "the card passes the reserved height");
  assert.deepEqual(mixSegments([]), [], "no rows, no segments");
  assert.deepEqual(mixSegments([{ key: "Cash", share: 0 }, { key: "Online", share: 0 }]), [], "a zero total draws no segment");
  assert.deepEqual(mixSegments([{ key: "Cash", share: 1 }]), [{ key: "Cash", pct: 100 }], "a single mode fills the bar");
  assert.deepEqual(
    mixSegments([{ key: "Cash", share: 1 / 3 }, { key: "Online", share: 2 / 3 }, { key: "Due", share: 0 }]),
    [{ key: "Cash", pct: 33.3 }, { key: "Online", pct: 66.7 }],
    "widths round to one decimal and a zero share is dropped",
  );
});

// ── Sales by hour and Live tables (U0 match Task 7, values 3.5, 3.6, ruling R15) ─────────────────────────────────────

// fixture(): Friday 16 Oct (today) against Friday 9 Oct. Three hours with sales in either series grow to the HTML's
// eight-hour minimum: 9 am – 4 pm. renderToStaticMarkup runs no effect, so the clock is unknown and no hour is "not yet".
const hourPoint = (h: number, sales: number, compareSales: number) => ({
  key: String(h),
  label: `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`,
  sales,
  orders: sales > 0 ? 1 : 0,
  compareLabel: `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`,
  compareSales,
});
const HOUR_SERIES = [hourPoint(11, 1520, 1180), hourPoint(12, 3470, 2630), hourPoint(13, 0, 5360)];
// Masked by default, as every visit to the dashboard starts (the mask, values 3.17).
const salesCard = async (over: Partial<DashboardData> = {}, extra: Partial<ReturnType<typeof ready>> & { shown?: boolean } = {}) => {
  const { SalesCard } = await import("@/components/dashboard/RangeCards");
  return renderToStaticMarkup(createElement(SalesCard, { ...ready({ series: HOUR_SERIES, ...over }), shown: false, ...extra }));
};
const allTags = (html: string, name: string): string[] => html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [];
const textsOf = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`data-ui="${name}"[^>]*>([^<]*)<`, "g"))].map((m) => m[1]);

test("SalesCard: the HTML's head - 'Sales by hour', '{period} · open hours, …', the legend at the right; the plot 18px under it", async () => {
  const html = await salesCard();
  assert.ok(tagOf(html, "sales-card").startsWith("<section"), "the card names itself for the probes (data-ui sales-card)");
  assert.ok(html.includes(">Sales by hour</h2>"), "the title (values 3.5)");
  assert.ok(html.includes(">Today · open hours, 9 am – 4 pm</p>"), "the sub: the period, then the window's first and last hour");
  hasAll(classesOf(html, "dash-card-head"), ["flex", "flex-wrap", "items-start", "justify-between", "gap-3"], "the head wraps (values 3.5)");
  hasAll(classesOf(html, "sales-legend"), ["flex", "items-center", "gap-3.5", "text-[12px]", "text-muted-foreground"], "the legend 12px text-2, 14 apart");
  hasAll(classesOf(html, "sales-legend-item"), ["flex", "items-center", "gap-1.5"], "a legend item: its mark 6px before the words");
  assert.ok(html.includes('<span class="size-2.5 rounded-[3px] bg-primary"></span><span>Today</span>'), "a 10px accent square, radius 3, then the period");
  assert.ok(
    html.includes('<span class="w-3.5 border-t-2 border-dashed border-subtle-foreground"></span><span>Last Fri</span>'),
    "a 14px 2px dashed text-3 rule, then the HTML's cmpShort",
  );
  assert.ok(html.includes('class="transition-opacity duration-200 mt-[18px] min-h-[301px] @min-[560px]:min-h-[276px]"'), "the plot row 18px under the head, the body as tall as loading and empty hold");
  assert.ok(!html.includes("pointer-coarse"), "ruling R1: no touch enlargement");
});

// Final review m1: the chart's accessible name (the bars' group name and the screen-reader table's caption) must not
// state the period's total while the sales are masked: it is the hero's masked Net sales. The hours may stay (the
// HTML's tooltips show them).
test("SalesCard's accessible name states the total only while the sales are shown (the mask, values 3.17)", async () => {
  const names = (html: string): string[] => [
    ...[...html.matchAll(/role="group" aria-label="([^"]*)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<caption>([^<]*)<\/caption>/g)].map((m) => m[1]),
  ];
  const masked = names(await salesCard({}, { shown: false }));
  assert.equal(masked.length, 2, `landmark: the bars' group name and the table's caption (got ${masked.length})`);
  for (const name of masked) {
    assert.ok(!name.includes("₹48,250") && !name.includes("in total"), `masked: no total in "${name}"`);
    assert.equal(name, "Sales by hour, Today, highest 12 pm with ₹3,470.", "masked: the period and its busiest hour");
  }
  const shown = names(await salesCard({}, { shown: true }));
  assert.equal(shown.length, 2, "landmark: both names when shown");
  for (const name of shown) assert.equal(name, "Sales by hour, Today: ₹48,250 in total, highest 12 pm with ₹3,470.", "shown: the total too");
  assert.match(readSrc(PAGE), /<SalesCard \{\.\.\.cards\} shown=\{reveal\.shown\} \/>/, "the page hands the card the mask's state");
});

test("HourBars: the 210px plot with 70px grid lines, the ticks, eight columns, bars max 34px radius 5 5 2 2, the dashed line", async () => {
  const html = await salesCard();
  hasAll(classesOf(html, "sales-plot-row"), ["flex", "gap-2.5"], "the plot row: ticks 10px from the plot");
  hasAll(
    classesOf(html, "sales-ticks"),
    ["-mt-1.5", "flex", "h-[210px]", "flex-col", "justify-between", "text-right", "font-mono", "text-[11px]", "text-subtle-foreground"],
    "the ticks: Geist Mono 11 text-3, spread over 210px, 6px up",
  );
  assert.deepEqual(textsOf(html, "sales-tick"), ["₹6k", "₹4k", "₹2k", "₹0"], "kf of the 3-step scale, top to bottom");
  hasAll(
    classesOf(html, "sales-plot"),
    ["relative", "h-[210px]", "border-b", "border-border", "bg-[repeating-linear-gradient(180deg,var(--border-2)_0_1px,transparent_1px_70px)]"],
    "the plot: 210px, a border-2 line every 70px, a border foot",
  );
  const layer = tagOf(html, "sales-bars");
  expectAll(layer, ["absolute", "inset-0", "flex", "items-end", "gap-(--bar-gap-xs)", "@min-[560px]:gap-(--bar-gap)"], "the bars layer");
  assert.ok(layer.includes("--bar-gap-xs:3px;--bar-gap:8px"), "db.L.barGap: 3px on a phone (xs), 8px from cw 560");
  const cols = allTags(html, "sales-col");
  assert.equal(cols.length, 8, "one column per hour of the window");
  for (const col of cols) {
    assert.ok(col.startsWith("<button"), "a column is a button: it takes focus and a tap");
    expectAll(col, ["relative", "flex", "h-full", "flex-1", "items-end", "justify-center"], "a column");
  }
  assert.ok(cols[3].includes('aria-label="12 pm: ₹3,470. Last Fri: ₹2,630"'), "a column reads its hour and both figures");
  // Fix round 1: one tab stop for the whole chart (a roving tabindex); the arrow keys, Home and End move along it and
  // Escape hides the tooltip (WCAG 1.4.13).
  assert.ok(cols[0].includes('tabindex="0"') && cols.slice(1).every((c) => c.includes('tabindex="-1"')), "only the first column is in the tab order");
  const barsSrc = readSrc("components/dashboard/HourBars.tsx");
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End", "Escape"]) assert.ok(barsSrc.includes(`"${key}"`), `the chart handles ${key}`);
  assert.ok(barsSrc.includes("tipShift("), "the tooltip is kept inside the card (tipShift)");
  const bars = allTags(html, "sales-bar");
  assert.equal(bars.length, 8, "one bar per column");
  for (const bar of bars) expectAll(bar, ["w-full", "max-w-[34px]", "min-h-[2px]", "rounded-[5px_5px_2px_2px]", "origin-bottom", "motion-safe:animate-grow-y"], "a bar");
  expectAll(bars[3], ["bg-primary"], "the peak bar is the accent");
  expectAll(bars[2], ["bg-chart-bar"], "another past bar is the 60 % tint");
  assert.ok(bars[3].includes("height:57.8%") && bars[3].includes("opacity:1"), "12 pm: ₹3,470 of ₹6,000, nothing hovered");
  assert.ok(!html.includes("bg-surface-3"), "no clock yet: no hour is 'not yet'");
  assert.ok(!html.includes('data-ui="sales-tip"'), "the tooltip shows only on a hovered or focused column");
  assert.ok(html.includes('viewBox="0 0 100 100" preserveAspectRatio="none"'), "the line's 0..100 box, stretched to the plot");
  assert.ok(
    html.includes('fill="none" stroke="var(--subtle-foreground)" stroke-width="1.6" stroke-dasharray="4 4" vector-effect="non-scaling-stroke" stroke-linejoin="round"'),
    "the comparison: a 1.6 text-3 dashed line that never scales",
  );
  expectAll(tagOf(html, "sales-line"), ["pointer-events-none", "absolute", "inset-0", "h-full", "w-full", "overflow-visible"], "the line's svg");
  assert.ok(html.includes('<div class="sr-only"><table><caption>'), "the screen-reader table stays");
});

test("HourBars: the x labels - 11px text-3 centred, every 2nd hour from cw 560, every 3rd on a phone", async () => {
  const html = await salesCard();
  const row = tagOf(html, "sales-xlabels");
  expectAll(row, ["mt-2", "flex", "gap-(--bar-gap-xs)", "@min-[560px]:gap-(--bar-gap)"], "the label row 8px under the plot, the bars' gap");
  const labels = allTags(html, "sales-xlabel");
  assert.equal(labels.length, 8, "one label cell per column");
  expectAll(labels[0], ["flex-1", "text-center", "text-[11px]", "text-subtle-foreground", "whitespace-nowrap"], "a label cell");
  const cells = [...html.matchAll(/data-ui="sales-xlabel"[^>]*>((?:<span[^>]*>[^<]*<\/span>)?)<\/span>/g)].map((m) => m[1]);
  assert.equal(cells[0], "<span>9am</span>", "9 am: every 2nd and every 3rd");
  assert.equal(cells[1], "", "10 am: neither");
  assert.equal(cells[2], '<span class="hidden @min-[560px]:inline">11am</span>', "11 am: every 2nd only");
  assert.equal(cells[3], '<span class="@min-[560px]:hidden">12pm</span>', "12 pm: every 3rd only (a phone)");
});

test("HourBars: the footer - 14px over a border-2 rule, Peak / Quietest / the comparison in 12.5 text-2 with 600 values", async () => {
  const html = await salesCard();
  hasAll(
    classesOf(html, "sales-footer"),
    ["mt-3.5", "flex", "flex-wrap", "gap-x-6", "gap-y-2", "border-t", "border-border-2", "pt-3", "text-[12.5px]", "text-muted-foreground"],
    "the footer",
  );
  assert.ok(html.includes('<span>Peak <b class="font-semibold text-foreground">12 pm · ₹3,470</b></span>'), "the peak hour");
  assert.ok(html.includes('<span>Quietest <b class="font-semibold text-foreground">1 pm · ₹0</b></span>'), "the quietest past hour of the span with sales (never a padded hour)");
  assert.ok(html.includes('<span>So far vs last fri <b class="font-semibold text-status-bad-ink">-46%</b></span>'), "today: so far, a fall in the bad ink");
});

test("SalesCard: a span of days draws the same bars per day, 'Sales by day', the HTML's span words; empty and loading keep the body's height", async () => {
  const week = await salesCard({
    range: { from: "2026-10-10", to: TODAY },
    mode: "day",
    compare: { from: "2026-10-03", to: "2026-10-09", label: "vs previous 7 days" },
    series: ["10", "11", "12", "13", "14", "15", "16"].map((dd, i) => ({ key: `2026-10-${dd}`, label: `${dd} Oct`, sales: 1000 * (i + 1), orders: 1, compareLabel: `${Number(dd) - 7} Oct`, compareSales: 900 })),
  }, { period: "Last 7 days" });
  assert.ok(week.includes(">Sales by day</h2>"), "ruling R15: our per-day series, titled by day");
  assert.ok(week.includes(">Last 7 days · 10 Oct – 16 Oct</p>"), "the span's dates");
  assert.ok(week.includes("<span>Last 7 days</span>") && week.includes("<span>Previous 7 days</span>"), "the legend: the period and the HTML's cmpShort");
  assert.equal(allTags(week, "sales-bar").length, 7, "one bar per day");
  assert.ok(week.includes('<span>vs previous 7 days <b class="font-semibold text-status-ok-ink">+344%</b></span>'), "a span: 'vs …', no 'so far'");
  // Fix round 1: a day's comparison is one aligned day, named by its own date (16 Oct against 9 Oct).
  assert.ok(allTags(week, "sales-col")[6].includes('aria-label="16 Oct: ₹7,000. 9 Oct: ₹900"'), "a day's column reads its date and its comparison day");
  const empty = await salesCard({ series: [] });
  assert.ok(empty.includes("No sales yet") && !empty.includes('data-ui="sales-legend"'), "today with no sales keeps our empty state, no legend");
  // Fix round 1: the reserved body covers the phone's two-line footer (301px below cw 560) and the one-line 276px.
  assert.ok(empty.includes("min-h-[301px] @min-[560px]:min-h-[276px]"), "the empty body holds the loaded body's height at every width");
  const { SalesCard } = await import("@/components/dashboard/RangeCards");
  const loading = renderToStaticMarkup(createElement(SalesCard, { ...ready(), data: undefined, status: "loading", shown: false }));
  assert.ok(loading.includes('<div class="flex mt-[18px] min-h-[301px] @min-[560px]:min-h-[276px]">'), "loading: the skeleton holds the same, 18px under the head");
});

// Our table states onto the HTML's four (rulings R15, fix round 1): Free = Available, Eating = Occupied, Bill printed =
// Occupied with a fresh first bill print on its running order, Reserved = Reserved (lib/dashboard/live-tables.ts, whose
// own tests pin the mapping). We have no "KOT pending" state.
test("LiveFloorPanel: the HTML's card - the pulsing dot, the 8px status bar, the legend, zone labels and 52px tiles per state", async () => {
  const { LiveFloorPanel } = await import("@/components/dashboard/LiveFloorPanel");
  const { LIVE_AREAS, LIVE_ORDERS, LIVE_RESERVATIONS, LIVE_TABLES } = await import("@/lib/dashboard/live-tables.fixtures");
  const html = renderToStaticMarkup(
    createElement(LiveFloorPanel, { tables: LIVE_TABLES, orders: LIVE_ORDERS, areas: LIVE_AREAS, reservations: LIVE_RESERVATIONS, onSelectOrder: noop }),
  );
  assert.ok(tagOf(html, "tables-card").startsWith("<section"), "the card names itself for the probes (data-ui tables-card)");
  hasAll(classesOf(html, "dash-card-title"), ["flex", "items-center", "gap-2", "text-[15px]", "font-semibold"], "the title row holds the dot 8px after the words");
  hasAll(classesOf(html, "tables-live-dot"), ["size-[7px]", "rounded-[50%]", "bg-status-ok", "motion-safe:animate-live-pulse"], "the 7px ok dot (the HTML's 50% radius), pulsing (motion-safe)");
  assert.ok(html.includes(">3 of 7 in use · 1 reserved</p>"), "the sub line (in use = eating + bill printed)");
  assert.match(html, /href="\/tables"[^>]*>Floor →<\/a>/, "the HTML's 'Floor →' link to our floor");
  hasAll(classesOf(html, "tables-bar"), ["flex", "h-2", "gap-0.5", "overflow-hidden", "rounded-[4px]"], "the status bar: 8px, radius 4, 2px apart");
  assert.ok(
    html.includes(
      '<span class="bg-status-ok" style="flex:3"></span><span class="bg-status-info" style="flex:2"></span><span class="bg-status-bill" style="flex:1"></span><span class="bg-status-reserved" style="flex:1"></span>',
    ),
    "one segment per state, as wide as its count, in the HTML's order",
  );
  hasAll(classesOf(html, "tables-legend"), ["mt-2.5", "flex", "flex-wrap", "gap-x-3.5", "gap-y-1.5", "text-[12px]", "text-muted-foreground"], "the legend");
  hasAll(classesOf(html, "tables-legend-item"), ["flex", "items-center", "gap-1.5"], "a legend item");
  assert.ok(
    html.includes('<span aria-hidden="true" class="size-2 rounded-[2px] bg-status-ok"></span><span>Free</span><b class="font-semibold text-foreground">3</b>'),
    "an 8px radius-2 swatch, the state, its count in 600",
  );
  assert.ok(
    html.includes('<span aria-hidden="true" class="size-2 rounded-[2px] bg-status-bill"></span><span>Bill printed</span><b class="font-semibold text-foreground">1</b>'),
    "the HTML's Bill printed item, from our first-print stamp",
  );
  hasAll(
    classesOf(html, "tables-zone"),
    ["mt-4", "mb-[7px]", "text-[11px]", "font-semibold", "uppercase", "tracking-[0.06em]", "text-subtle-foreground"],
    "a zone label",
  );
  assert.deepEqual(textsOf(html, "tables-zone"), ["AC Hall", "Garden", "Other tables"], "the zones in order; the tables in no area as the Floor names them");
  hasAll(classesOf(html, "tables-grid"), ["grid", "grid-cols-[repeat(auto-fill,minmax(92px,1fr))]", "gap-1.5"], "92px tiles, 6px apart");
  const tiles = allTags(html, "table-tile");
  assert.equal(tiles.length, 7, "every table is a tile");
  const base = ["flex", "h-[52px]", "min-w-0", "flex-col", "items-start", "gap-0.5", "rounded-[9px]", "border", "px-2", "py-[7px]", "text-left", "text-foreground", "hover:border-subtle-foreground", ...HTML_PRESS_CLASS.split(" ")];
  for (const t of tiles) expectAll(t, base, "a tile");
  expectAll(tiles[0], ["border-status-reserved-border", "bg-status-reserved-tint"], "reserved: res-t on res-b");
  expectAll(tiles[1], ["border-border", "bg-card"], "free: the surface on the border");
  expectAll(tiles[2], ["border-status-info-border", "bg-status-info-tint"], "eating: info-t on info-b");
  expectAll(tiles[5], ["border-status-bill-border", "bg-status-bill-tint"], "bill printed: bill-t on bill-b");
  for (const i of [2, 4, 5]) assert.ok(tiles[i].startsWith("<button"), `tile ${i + 1}: an occupied tile with an order opens it (our detail sheet)`);
  for (const i of [0, 1, 3, 6]) assert.ok(tiles[i].startsWith("<a") && tiles[i].includes('href="/tables"'), `tile ${i + 1} goes to the floor`);
  assert.ok(tiles[2].includes('title="T-4 · 6 seats · Occupied"'), "the tile's title");
  hasAll(classesOf(html, "table-tile-name"), ["flex", "max-w-full", "items-center", "gap-[5px]", "text-[12.5px]", "font-semibold"], "line 1: 12.5/600, the dot 5px before the name");
  assert.ok(html.includes('<span aria-hidden="true" class="size-1.5 shrink-0 rounded-[50%] bg-status-reserved"></span><span class="truncate">T-1</span>'), "a 6px dot in the state's colour, then the name");
  assert.ok(html.includes('<span aria-hidden="true" class="size-1.5 shrink-0 rounded-[50%] bg-status-bill"></span><span class="truncate">T-8</span>'), "bill printed: the bill dot");
  const lines = allTags(html, "table-tile-line");
  for (const l of lines) expectAll(l, ["max-w-full", "truncate", "text-[10.5px]", "font-medium"], "line 2: 10.5/500, one line");
  expectAll(lines[0], ["text-status-reserved-ink"], "reserved line in res-i");
  expectAll(lines[1], ["text-subtle-foreground"], "free line in text-3");
  expectAll(lines[2], ["text-status-info-ink"], "eating line in info-i");
  expectAll(lines[5], ["text-status-bill-ink"], "bill printed line in bill-i");
  assert.deepEqual(
    textsOf(html, "table-tile-line"),
    ["7:00 PM", "4 seats", "₹768", "4 seats", "Occupied", "Bill printed", "2 seats"],
    "no clock in a static render: the bill alone",
  );
  assert.ok(!html.includes("pointer-coarse"), "ruling R1");
  const page = readSrc(PAGE);
  assert.match(page, /const tableAreas = useTableAreas\(tables\.data\);/, "the page reads our areas (the persisted master, healed like the Floor's)");
  assert.match(page, /<LiveFloorPanel[\s\S]*?areas=\{tableAreas\.data\}[\s\S]*?reservations=\{reservations\.data\}[\s\S]*?\/>/, "…and gives the panel the areas and today's bookings");
});

test("DashCard dashboard: an aside at the head's right, a title adornment and a wrapping head (Task 7's cards)", () => {
  const html = card({ variant: "dashboard", link: undefined, aside: createElement("span", { "data-ui": "x-aside" }, "legend"), titleAdornment: createElement("i", null), headWrap: true });
  hasAll(classesOf(html, "dash-card-head"), ["flex", "flex-wrap", "items-start", "justify-between", "gap-3"], "headWrap: the HTML's flex-wrap head");
  hasAll(classesOf(html, "dash-card-title"), ["flex", "items-center", "gap-2", "text-[15px]", "font-semibold"], "a title with an adornment lays it 8px after the words");
  assert.ok(html.includes('Sales<i></i></h2>'), "the adornment follows the title's words");
  assert.ok(html.includes('<span data-ui="x-aside">legend</span></header>'), "the aside closes the head, at its right");
  const plain = card({ variant: "dashboard" });
  assert.ok(!classesOf(plain, "dash-card-head").includes("flex-wrap") && !classesOf(plain, "dash-card-title").includes("flex"), "without them the head is as before");
});

// ── Recent orders, Today's reservations, Money leaks (U0 match Task 8, values 3.7, 3.8, 3.11, ruling R17) ─────────────

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const orderLine = (qty: number) => ({ productId: "p", name: "Tea", price: 10, qty, modifiers: [], instructions: "", kotRound: 1 });
const recentOrder = (seq: string, over: Record<string, unknown>): Order =>
  ({
    _id: seq,
    orderId: `ORD-20261016-${seq}`,
    customerName: "Walk-in",
    items: [orderLine(1)],
    subtotal: 0,
    discount: 0,
    total: 100,
    paidAmount: 100,
    payment: "Cash",
    status: "Completed",
    receiver: "",
    kotRounds: 1,
    createdAt: minutesAgo(5),
    updatedAt: "",
    ...over,
  }) as unknown as Order;
// Newest first, as GET /api/orders sorts them: a dine-in, a takeaway, a QR order at a table (an open tab), a walk-in on
// due, a cancelled bill at a table named without digits, and a sixth the card leaves out.
const RECENT = [
  recentOrder("012", { tableNo: "T-12", payment: "Online", total: 879, items: [orderLine(2), orderLine(1)] }),
  recentOrder("011", { parcel: true, payment: "Cash", total: 595 }),
  recentOrder("010", { source: "qr", tableNo: "T-3", payment: "Unpaid", status: "Pending", total: 450, items: [orderLine(2)] }),
  recentOrder("009", { payment: "Due", total: 1019 }),
  recentOrder("008", { tableNo: "Garden", payment: "Split", status: "Cancelled", total: 659 }),
  recentOrder("007", { tableNo: "T-1", total: 300 }),
];

test("RecentOrders: the HTML's rows - the 40px code tile, '#NNN · {table | Walk-in}', '{type} · {n} items · {ago}', the pay pill, the mono amount", async () => {
  const { RecentOrders } = await import("@/components/dashboard/RecentOrders");
  const html = renderToStaticMarkup(createElement(RecentOrders, { orders: RECENT, onSelect: noop }));
  const section = tagOf(html, "recent-card");
  assert.ok(section.startsWith("<section"), "the card names itself for the probes (data-ui recent-card)");
  expectAll(section, ["px-5", "py-[18px]", "pb-2"], "the generic card with the HTML's 8px foot (values 3.7)");
  assert.ok(html.includes(">Recent orders</h2>") && html.includes(">Today · newest first</p>"), "the title and our sub (every status of today, ruling R17)");
  assert.match(html, /href="\/orders"[^>]*>All orders →<\/a>/, "the HTML's 'All orders →' to our Orders");
  assert.ok(html.includes('<div style="min-height:305px" class="transition-opacity duration-200 mt-2.5">'), "the list 10px under the head, five 61px rows reserved");
  expectAll(tagOf(html, "recent-list"), ["flex", "flex-col"], "the list");
  const rows = allTags(html, "recent-row");
  assert.equal(rows.length, 5, "at most five rows, newest first");
  const rowClasses = [
    "-mx-2", "grid", "grid-cols-[40px_minmax(0,1fr)_auto]", "@min-[560px]:grid-cols-[40px_minmax(0,1fr)_auto_84px]", "items-center", "gap-3",
    "rounded-[10px]", "border-t", "border-border-2", "px-2", "py-2.5", "text-left", "text-foreground", "hover:bg-hover", ...HTML_PRESS_CLASS.split(" "),
  ];
  for (const r of rows) {
    assert.ok(r.startsWith('<button type="button"'), "a row is a button (it opens our order detail sheet)");
    expectAll(r, rowClasses, "a row: the HTML's orderCols, gap 12, 10px 8px with margin 0 -8px, radius 10, a border-2 rule");
  }
  for (const t of allTags(html, "recent-code")) {
    expectAll(t, ["flex", "size-10", "items-center", "justify-center", "rounded-[10px]", "bg-surface-3", "text-[12.5px]", "font-semibold"], "the 40px code tile");
  }
  assert.deepEqual(textsOf(html, "recent-code"), ["T12", "TA", "QR", "WI", "GA"], "our codes: T{digits} at a table, TA takeaway, QR self-order, WI walk-in, a name's letters without digits");
  for (const t of allTags(html, "recent-title")) expectAll(t, ["block", "text-[14px]", "font-semibold"], "the title 14/600");
  assert.deepEqual(textsOf(html, "recent-title"), ["#012 · T-12", "#011 · Walk-in", "#010 · T-3", "#009 · Walk-in", "#008 · Garden"], "'#NNN · {table | Walk-in}'");
  for (const t of allTags(html, "recent-meta")) expectAll(t, ["mt-0.5", "block", "truncate", "text-[12.5px]", "text-subtle-foreground"], "the meta 12.5 text-3 on one line");
  assert.deepEqual(
    textsOf(html, "recent-meta"),
    ["Dine-in · 3 items · 5m ago", "Takeaway · 1 item · 5m ago", "QR self-order · 2 items · 5m ago", "Counter · 1 item · 5m ago", "Dine-in · 1 item · 5m ago"],
    "'{type} · {n} items · {ago}' in our words (our channel names, our time ago)",
  );
  const pills = allTags(html, "recent-pay");
  for (const p of pills) {
    expectAll(p, ["hidden", "@min-[560px]:flex", "items-center", "[justify-self:start]", "h-6", "rounded-[12px]", "px-[9px]", "text-[12px]", "font-semibold"], "the pay pill: 24px, 0 9px, radius 12, 12/600, gone below cw 560 (wideF)");
  }
  expectAll(pills[0], ["bg-status-info-tint", "text-status-info-ink"], "Online: the HTML's UPI blue (accent-t / accent-i)");
  expectAll(pills[1], ["bg-status-ok-tint", "text-status-ok-ink"], "Cash: ok-t / ok-i as the HTML's");
  expectAll(pills[2], ["bg-status-warn-tint", "text-status-warn-ink"], "an open tab: warn");
  expectAll(pills[3], ["bg-status-bill-tint", "text-status-bill-ink"], "Due: bill");
  expectAll(pills[4], ["bg-status-bad-tint", "text-status-bad-ink"], "Cancelled: bad, as the HTML's Refunded");
  assert.deepEqual(textsOf(html, "recent-pay"), ["Online", "Cash", "Open", "Due", "Cancelled"], "our payment words");
  const amounts = allTags(html, "recent-amount");
  for (const a of amounts) expectAll(a, ["text-right", "font-mono", "text-[14px]", "font-semibold"], "the amount: Geist Mono 600 14, right");
  assert.deepEqual(textsOf(html, "recent-amount"), ["₹879", "₹595", "₹450", "₹1,019", "₹659"], "the totals");
  expectAll(amounts[4], ["line-through", "text-subtle-foreground"], "a cancelled bill's amount struck through");
  assert.ok(!clsOf(amounts[0]).includes("line-through"), "a sale is not struck");
  assert.ok(!/brand-|divide-y/.test(html), "no Paper & Ink token or divider list left");

  const empty = renderToStaticMarkup(createElement(RecentOrders, { orders: [], onSelect: noop }));
  assert.ok(empty.includes('<p data-ui="dash-empty" class="py-6 text-center text-[13px] text-subtle-foreground">No orders yet today</p>'), "no orders: the HTML's one empty line with our words");
});

const booking = (id: string, over: Record<string, unknown>): Reservation =>
  ({ _id: id, name: "Guest", mobile: "", date: "2026-10-16", time: "19:00", guests: 2, status: "Booked", createdAt: "", updatedAt: "", ...over }) as unknown as Reservation;
const BOOKINGS = [
  booking("r1", { name: "Rahul Mehta", time: "19:30", guests: 4, tableNo: "T-3" }),
  booking("r2", { name: "Kapoor family", time: "13:00", guests: 1, status: "Seated" }),
  booking("r3", { name: "Gone", time: "12:00", status: "Cancelled" }),
];

test("TodayReservations: the HTML's rows - the 64px time pill, who 14/500, '{guests} guests · {table}', the 30px Seat button; seated shows a pill", async () => {
  const html = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TodayReservations, { reservations: BOOKINGS })),
  );
  const section = tagOf(html, "res-card");
  assert.ok(section.startsWith("<section"), "the card names itself (data-ui res-card)");
  expectAll(section, ["flex", "flex-col", "py-[18px]"], "the generic card as a column (values 3.8)");
  assert.ok(html.includes(">Today&#x27;s reservations</h2>"), "the title");
  assert.ok(html.includes(">2 bookings · by time</p>"), "the HTML's sub: '{n} bookings · by time' (a seated booking is still a booking)");
  const one = renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(TodayReservations, { reservations: BOOKINGS.slice(1) })),
  );
  assert.ok(one.includes(">1 booking · by time</p>"), "one booking is singular");
  assert.match(html, /href="\/reservations"[^>]*>View all →<\/a>/, "the HTML's 'View all →' to our Reservations");
  assert.ok(html.includes('<div style="min-height:165px" class="transition-opacity duration-200 mt-2.5">'), "the list 10px under the head, three 55px rows reserved");
  const rows = allTags(html, "res-row");
  assert.equal(rows.length, 2, "booked and seated only");
  for (const r of rows) expectAll(r, ["flex", "items-center", "gap-3", "border-t", "border-border-2", "py-2.5"], "a row: 10px 0 over a border-2 rule, gap 12");
  for (const t of allTags(html, "res-time")) {
    expectAll(
      t,
      ["flex", "h-[30px]", "w-16", "flex-none", "items-center", "justify-center", "whitespace-nowrap", "rounded-[8px]", "bg-status-reserved-tint", "text-[12.5px]", "font-semibold", "text-status-reserved-ink"],
      "the 64px x 30 time pill in res-t / res-i",
    );
  }
  assert.deepEqual(textsOf(html, "res-time"), ["1:00 PM", "7:30 PM"], "by time");
  for (const t of allTags(html, "res-who")) expectAll(t, ["block", "truncate", "text-[14px]", "font-medium"], "who: 14/500 on one line");
  assert.deepEqual(textsOf(html, "res-who"), ["Kapoor family", "Rahul Mehta"], "the names");
  for (const t of allTags(html, "res-where")) expectAll(t, ["block", "text-[12px]", "text-subtle-foreground"], "where: 12px text-3");
  assert.deepEqual(textsOf(html, "res-where"), ["1 guest", "4 guests · T-3"], "'{guests} guests · {table}'");
  const seats = allTags(html, "res-seat");
  assert.equal(seats.length, 1, "a Seat button on the booked row only");
  assert.ok(seats[0].startsWith('<button type="button"') && seats[0].includes('aria-label="Seat Rahul Mehta"'), "our seat action, named for the guest");
  expectAll(
    seats[0],
    ["h-[30px]", "rounded-[8px]", "border", "border-border", "bg-card", "px-[11px]", "text-[12.5px]", "font-medium", "text-foreground", "hover:bg-hover", ...HTML_PRESS_CLASS.split(" ")],
    "Seat: the HTML's 30px outline button",
  );
  assert.deepEqual(textsOf(html, "res-seat"), ["Seat"], "the HTML's word");
  const seated = allTags(html, "res-seated");
  assert.equal(seated.length, 1, "a seated booking shows a pill instead");
  expectAll(seated[0], ["flex", "h-6", "items-center", "rounded-[12px]", "px-[9px]", "text-[12px]", "font-semibold", "bg-status-ok-tint", "text-status-ok-ink"], "the ok 'Seated' pill (ruling R17)");
  assert.deepEqual(textsOf(html, "res-seated"), ["Seated"], "our status");
  assert.ok(!/brand-|divide-y|lucide-chef-hat/.test(html), "no Paper & Ink token, divider list or chef-hat icon left");
});

const LEAKS = {
  cancelled: { count: 2, value: 780 },
  voids: { lines: 3, qty: 5, value: 1140 },
  discounts: { orders: 1, amount: 1840 },
  rewards: { orders: 0, amount: 0 },
};
const LEAK_GLYPHS = [
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  "M20 12v9H4v-9M2 7h20v5H2zM12 21V7",
];

test("LeaksCard: the HTML's Money leaks - the lost-total pill, rows of a 32px tile with the HTML's glyphs, label and sub, the coloured mono amount", async () => {
  const { LeaksCard } = await import("@/components/dashboard/RangeCards");
  const html = renderToStaticMarkup(createElement(LeaksCard, ready({ leaks: LEAKS })));
  assert.ok(tagOf(html, "leak-card").startsWith("<section"), "the card names itself (data-ui leak-card)");
  assert.ok(html.includes(">Money leaks</h2>") && html.includes(">Cancelled, voided and given away</p>"), "the HTML's title and sub (ruling R17)");
  const head = classesOf(html, "dash-card-head");
  hasAll(head, ["flex", "items-start", "justify-between", "gap-2.5"], "the head 10px apart (values 3.11)");
  assert.ok(!head.includes("gap-3"), "not the generic 12px");
  expectAll(
    tagOf(html, "leak-pill"),
    ["flex", "h-6", "items-center", "whitespace-nowrap", "rounded-[12px]", "px-[9px]", "text-[12px]", "font-semibold", "bg-status-bad-tint", "text-status-bad-ink"],
    "the total pill in bad-t / bad-i",
  );
  assert.deepEqual(textsOf(html, "leak-pill"), ["₹3,760 lost"], "the four amounts added up");
  assert.ok(html.includes('<div style="min-height:212px" class="transition-opacity duration-200 mt-2.5">'), "the rows 10px under the head, four 53px rows reserved");
  const rows = allTags(html, "leak-row");
  assert.equal(rows.length, 4, "four rows");
  for (const r of rows) expectAll(r, ["flex", "items-center", "gap-3", "border-t", "border-border-2", "py-[9px]"], "a row: 9px 0 over a border-2 rule, gap 12");
  assert.ok(rows[0].startsWith("<a") && rows[0].includes('href="/orders?status=Cancelled"'), "Cancelled orders keeps its link to the cancelled orders");
  for (const r of rows.slice(1)) assert.ok(r.startsWith("<div"), "the other rows are not links");
  const tiles = allTags(html, "leak-tile");
  for (const t of tiles) expectAll(t, ["flex", "size-8", "flex-none", "items-center", "justify-center", "rounded-[9px]"], "the 32px tile, radius 9");
  for (const t of tiles.slice(0, 3)) expectAll(t, ["bg-status-bad-tint", "text-status-bad-ink"], "money lost: bad-t / bad-i");
  expectAll(tiles[3], ["bg-surface-3", "text-subtle-foreground"], "nothing lost: surface-3 / text-3");
  for (const d of LEAK_GLYPHS) assert.ok(html.includes(`<path d="${d}"></path>`), `the HTML's glyph ${d.slice(0, 12)}… (values 5)`);
  const svgs = (html.match(/<svg[^>]*>/g) ?? []).filter((s) => /width="16" height="16"/.test(s) && s.includes('stroke-width="1.8"') && s.includes('stroke-linecap="round"') && s.includes('stroke-linejoin="round"'));
  assert.equal(svgs.length, 4, "each glyph at 16px, stroke 1.8, round caps and joins");
  for (const t of allTags(html, "leak-label")) expectAll(t, ["block", "text-[13.5px]", "font-medium"], "the label 13.5/500");
  assert.deepEqual(textsOf(html, "leak-label"), ["Cancelled orders", "Voided items", "Discounts given", "Rewards given"], "our four rows");
  for (const t of allTags(html, "leak-sub")) expectAll(t, ["block", "text-[12px]", "text-subtle-foreground"], "the sub 12px text-3");
  assert.deepEqual(textsOf(html, "leak-sub"), ["2 orders", "5 items", "1 order", "0 orders"], "our subs");
  const amounts = allTags(html, "leak-amount");
  for (const a of amounts) expectAll(a, ["font-mono", "text-[13.5px]", "font-semibold"], "the amount: Geist Mono 600 13.5");
  for (const a of amounts.slice(0, 3)) expectAll(a, ["text-status-bad-ink"], "money lost in bad-i");
  expectAll(amounts[3], ["text-subtle-foreground"], "₹0 in text-3");
  assert.deepEqual(textsOf(html, "leak-amount"), ["− ₹780", "− ₹1,140", "− ₹1,840", "₹0"], "'− ₹X', or ₹0");

  const none = { cancelled: { count: 0, value: 0 }, voids: { lines: 0, qty: 0, value: 0 }, discounts: { orders: 0, amount: 0 }, rewards: { orders: 0, amount: 0 } };
  const clean = renderToStaticMarkup(createElement(LeaksCard, ready({ leaks: none })));
  expectAll(tagOf(clean, "leak-pill"), ["bg-status-ok-tint", "text-status-ok-ink"], "nothing lost: ok-t / ok-i");
  assert.deepEqual(textsOf(clean, "leak-pill"), ["Nothing lost"], "the HTML's words");
  const loading = renderToStaticMarkup(createElement(LeaksCard, { ...ready(), data: undefined, status: "loading" }));
  assert.ok(!loading.includes('data-ui="leak-pill"'), "no total until the leaks load");
  // Fix round 1: the pill sits in the head, outside the dimmed body: it dims with it while the next range loads.
  expectAll(tagOf(html, "leak-pill"), ["transition-opacity", "duration-200"], "the pill fades like the body");
  assert.ok(!clsOf(tagOf(html, "leak-pill")).includes("opacity-55"), "full strength when the range is current");
  const updating = renderToStaticMarkup(createElement(LeaksCard, { ...ready({ leaks: LEAKS }), updating: true }));
  expectAll(tagOf(updating, "leak-pill"), ["opacity-55"], "the previous range's total dims while the new one loads");
});

// Fix round 1 (item 6): the code tile takes the FIRST run of digits of the table's name, never more than fits the 40px
// tile (T + three digits).
test("recentOrderCode: T + the first digit run of the table name (at most three digits); the name's letters without one", async () => {
  const { recentOrderCode } = await import("@/components/dashboard/RecentOrders");
  const at = (tableNo: string) => recentOrderCode(recentOrder("001", { tableNo }));
  assert.equal(at("T-12"), "T12", "T-12 -> T12");
  assert.equal(at("Patio 2 seat 4"), "T2", "the first run of digits only");
  assert.equal(at("Table 104"), "T104", "three digits fit");
  assert.equal(at("Hall 12345"), "T123", "never more than three digits (the 40px tile)");
  assert.equal(at("Garden"), "GA", "no digits: the name's first two letters");
  assert.equal(recentOrderCode(recentOrder("002", { parcel: true, tableNo: "T-4" })), "TA", "a takeaway");
  assert.equal(recentOrderCode(recentOrder("003", { source: "qr", tableNo: "T-4" })), "QR", "a QR order");
  assert.equal(recentOrderCode(recentOrder("004", {})), "WI", "a walk-in");
});
