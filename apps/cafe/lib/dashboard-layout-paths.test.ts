import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "@/lib/source-pin-utils";
import { MONEY_BREAKDOWN_LINES, MONEY_NET_LABEL } from "@/lib/money-breakdown";
import { menuItemsHref } from "@/lib/menu-sections";
import { presetRange } from "@/lib/dashboard/range";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { AttentionStrip, attentionItems } from "@/components/dashboard/AttentionStrip";
import { DashCard } from "@/components/dashboard/DashCard";
import { RangeBar } from "@/components/dashboard/RangeBar";
import { MoneyBreakdownCard } from "@/components/reports/MoneyBreakdownCard";
import type { DashboardData, DashboardLive } from "@/types/dashboard";

// The dashboard in the owner's mock-up arrangement (UI redesign, Task 18):
// every card, figure, word and link it had stays; only the order and the look
// change. The KPI row becomes the dark Net sales hero, the bill breakdown a
// receipt, the strip folds on a phone, the period picker is segmented.
// SalesHero and KpiChange are new modules, imported inside their tests.

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
    "<MoneyBreakdownCard",
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

test("the header names the page: PageHeader 'Dashboard' with the cafe line by default and End of day + date as its actions", () => {
  const page = readSrc(PAGE);
  assert.match(
    page,
    /<PageHeader\s+title="Dashboard"\s+className="gap-2\.5"\s+actions=\{<EndOfDayButton variant="header" \/>\}\s*\/>/,
    "the page's header: its title, the HTML's 10px gap in the phone's body row, and the End of day pair as its actions",
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

test("EndOfDayButton variant 'header': End of day then the date, as the HTML's 36px outline header buttons; the default look stays", () => {
  const src = readSrc("components/reports/EndOfDayButton.tsx");
  assert.match(src, /export function EndOfDayButton\(\{ variant = "inline" \}: \{ variant\?: "inline" \| "header" \}\)/, "a variant prop, today's look by default");
  // Today's look (its pins live in print-paths, print-routing, date-input): the date, then a small outline button.
  assert.ok(src.includes('<div className="flex items-center gap-2">'), "the inline pair keeps its row");
  assert.ok(src.includes('className={header ? "w-auto" : "h-8 w-auto"}'), "the inline date keeps h-8 w-auto");
  assert.ok(src.includes('size={header ? undefined : "sm"}'), "the inline button keeps size sm");
  assert.ok(src.includes('<CalendarCheck className="mr-2 h-4 w-4" /> End of day'), "the inline button keeps its icon and words");
  // The header look (values 2.5): outline, the printer glyph, the HTML's title; the date as a second outline button.
  assert.ok(src.includes("className={header ? HEADER_OUTLINE_BUTTON_CLASS : undefined}"), "the header's outline button class");
  assert.ok(src.includes('title={header ? "Print end-of-day report" : undefined}'), "the HTML's title (also the icon-only button's name)");
  assert.match(src, /<GlyphPrinter aria-hidden="true" strokeWidth=\{1\.8\} \/>/, "the HTML's printer glyph");
  assert.match(src, /<NavBookings aria-hidden="true" strokeWidth=\{1\.8\} \/>/, "the HTML's calendar glyph on the date");
  assert.ok(src.includes('const HEADER_LABEL_CLASS = "hidden min-[560px]:inline";'), "labels hidden below 560px (the HTML's wideI: cw < 560)");
  assert.ok(src.includes('{ day: "numeric", month: "short", timeZone: CAFE_TIMEZONE }'), "the date reads '19 Oct'");
  assert.match(src, /\{header \? \(\s*<>\s*\{button\}\s*\{picker\}\s*<\/>\s*\) : \(/, "in the header: End of day first, then the date");
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
    /<p data-ui="period-sub" className="mt-0\.5 text-\[12\.5px\] text-muted-foreground max-tab:min-h-\[32\.5px\]">\s*\{periodSubline\(shownRange, d, today\)\}\s*<\/p>/,
    "the sub line (two lines held on a phone, where our comparison wraps, so the figures arriving never move the page)",
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

// ── the Net sales hero ──────────────────────────────────────────────────────

test("SalesHero: a dark card with Net sales big and its change as a pill, then Orders, Average order and Collected with the dues hint", async () => {
  const { SalesHero } = await import("@/components/dashboard/SalesHero");
  const html = renderToStaticMarkup(createElement(SalesHero, ready()));
  assert.ok(html.includes("bg-ink") && html.includes("text-on-ink"), "the dark ink card");
  const inOrder = ["Net sales", "₹48,250", "Orders", "126", "Average order", "₹383", "Collected", "₹46,980", "+ ₹100 paid against earlier dues"];
  let last = -1;
  for (const text of inOrder) {
    const at = html.indexOf(text, last + 1);
    assert.ok(at > last, `"${text}" is on the hero, after the one before it`);
    last = at;
  }
  assert.ok(html.includes("rounded-full"), "the Net sales change sits in a pill");
  assert.equal((html.match(/<span class="sr-only">Up<\/span>/g) ?? []).length, 3, "three figures went up (Collected is flat) and say so in words");
  assert.ok(html.includes("No change,"), "Collected's flat change is said in words");
  assert.ok(html.includes("vs Fri, 9 Oct"), "the comparison wording stays");
  assert.ok(!html.includes("text-brand-up"), "the light page's green (#16733a) is about 3:1 on the ink card: the hero uses its own lighter green");
  assert.ok(!html.includes('aria-busy="true"'), "a ready hero is not busy");
});

test("SalesHero: loading keeps the labels with skeletons, updating dims the figures, no hint without earlier dues", async () => {
  const { SalesHero } = await import("@/components/dashboard/SalesHero");
  const loading = renderToStaticMarkup(createElement(SalesHero, { ...ready(), data: undefined, status: "loading" as const }));
  for (const label of ["Net sales", "Orders", "Average order", "Collected"]) {
    assert.ok(loading.includes(label), `loading still names ${label}`);
  }
  assert.ok(loading.includes('aria-busy="true"'), "loading is busy");
  assert.ok(!loading.includes("₹"), "no figure while loading");
  assert.ok(loading.includes("animate-pulse"), "skeletons while loading");
  const error = renderToStaticMarkup(createElement(SalesHero, { ...ready(), data: undefined, status: "error" as const }));
  assert.ok(error.includes("animate-pulse") && !error.includes("₹"), "an error with no data keeps the skeletons, as the KPI row did");
  const updating = renderToStaticMarkup(createElement(SalesHero, { ...ready(), updating: true }));
  assert.ok(updating.includes("opacity-55"), "the old range's figures dim while the new one loads");
  assert.ok(updating.includes('aria-busy="true"'), "updating is busy");
  const noDues = renderToStaticMarkup(createElement(SalesHero, ready({ duesCollected: 0 })));
  assert.ok(!noDues.includes("paid against earlier dues"), "no hint when no earlier dues were paid");
});

test("KpiChange: the dark tone's up and down colours are tokens, and read at 4.5:1 on the ink card and on their pill tints", async () => {
  const { KpiChange, KPI_CHANGE_DARK } = await import("@/components/dashboard/KpiChange");
  const css = readFileSync(path.join(HERE, "..", "app/globals.css"), "utf8");
  const ink = /:root\s*\{[^}]*?--ink:\s*(#[0-9a-f]{6});/i.exec(css)?.[1];
  assert.ok(ink, "landmark: the light theme's --ink in app/globals.css");
  const darkBlock = /\n\.dark\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const darkInk = /--ink:\s*(#[0-9a-f]{6});/i.exec(darkBlock)?.[1];
  assert.ok(darkInk, "landmark: the dark theme's --ink");
  assert.ok(!/#[0-9a-f]{6}/i.test(KPI_CHANGE_DARK.good + KPI_CHANGE_DARK.bad), "no literal hex left in the dark tone's text colours");
  const tokens = { good: "on-ink-up", bad: "on-ink-down" } as const;
  for (const way of ["good", "bad"] as const) {
    assert.ok(KPI_CHANGE_DARK[way].includes(`text-${tokens[way]}`), `dark ${way} wears text-${tokens[way]}`);
    assert.ok(themeHas(css, tokens[way]), `--color-${tokens[way]} is registered in @theme inline`);
    assert.equal(KPI_CHANGE_DARK[`${way}Pill`], `bg-${tokens[way]}-tint`, `dark ${way} pill wears the bg-${tokens[way]}-tint token`);
    assert.ok(themeHas(css, `${tokens[way]}-tint`), `--color-${tokens[way]}-tint is registered in @theme inline`);
    const lightBlock = /:root\s*\{[^}]*?--on-ink-up:[^}]*\}/.exec(css)?.[0] ?? "";
    const lightText = new RegExp(`--${tokens[way]}: *(#[0-9a-f]{6});`, "i").exec(lightBlock)?.[1];
    const darkText = new RegExp(`--${tokens[way]}: *(#[0-9a-f]{6});`, "i").exec(darkBlock)?.[1];
    assert.ok(lightText && darkText, `--${tokens[way]} is set in :root and in .dark`);
    for (const [text, card] of [[lightText, ink], [darkText, darkInk]] as const) {
      assert.ok(contrast(text, card) >= 4.5, `${text} on the ink ${card} is ${contrast(text, card).toFixed(2)}:1`);
      const pill = new RegExp(`--${tokens[way]}-tint: *(#[0-9a-f]{6});`, "i").exec(card === ink ? lightBlock : darkBlock)?.[1] ?? "";
      assert.ok(pill, `--${tokens[way]}-tint is an opaque hex in this theme`);
      assert.ok(contrast(text, pill) >= 4.5, `${text} on its pill ${pill} is ${contrast(text, pill).toFixed(2)}:1`);
    }
  }
  const html = renderToStaticMarkup(
    createElement(KpiChange, { delta: 0.124, compareLabel: "vs last Friday", noCompareText: "", upIsGood: true, tone: "dark", pill: true }),
  );
  assert.ok(html.includes(KPI_CHANGE_DARK.good) && html.includes(KPI_CHANGE_DARK.goodPill), "an up change wears the dark good colours");
  assert.ok(html.includes('<span class="sr-only">Up</span>'), "the direction is said in words");
});

function themeHas(css: string, name: string): boolean {
  return css.includes(`--color-${name}: var(--${name});`);
}

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
    ["flex", "items-center", "gap-[9px]", "h-[34px]", "pl-3", "pr-[5px]", "border", "border-border", "rounded-[17px]", "bg-card", "text-foreground", "text-[13px]", "whitespace-nowrap", "hover:border-subtle-foreground"],
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
  hasAll(classesOf(html, "attention-toggle"), ["flex", "h-12", "w-full", "min-w-0", "items-center", "gap-2.5", "px-3", "text-left"], "the card's toggle");
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
  hasAll(classesOf(html, "attention-item"), ["flex", "min-h-[46px]", "items-center", "gap-2.5", "px-3", "py-2", "text-left", "text-[13px]", "text-foreground"], "a row");
  assert.ok(!classesOf(html, "attention-item", 0).includes("border-t"), "the first row has no rule");
  hasAll(classesOf(html, "attention-item", 1), ["border-t", "border-border-2"], "the next rows' rule");
  hasAll(
    classesOf(html, "attention-item-action"),
    ["flex", "h-7", "flex-none", "items-center", "rounded-[8px]", "px-[11px]", "bg-surface-3", "text-[12px]", "font-semibold"],
    "a row's action",
  );
  hasAll(classesOf(html, "attention-item-dot"), ["mx-2.5"], "a row's dot (margin 0 10px)");
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
  const buttons = admin.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
  assert.deepEqual(
    buttons.map((b) => />([^<]*)</.exec(b)?.[1]),
    ["Today", "Yesterday", "7 days", "30 days", "Custom"],
    "the HTML's four, then our Custom (admin)",
  );
  buttons.forEach((b, i) => {
    const classes = /class="([^"]*)"/.exec(b)?.[1].split(" ") ?? [];
    assert.ok(b.includes('data-ui="period-button"'), `button ${i + 1} is a period button`);
    hasAll(classes, ["rounded-[7px]", "px-3", "text-[13px]", "whitespace-nowrap"], `button ${i + 1}`);
    assert.ok(!classes.some((c) => /^h-/.test(c)), `button ${i + 1} stretches to the track (30px) as the HTML's`);
    if (i === 0) hasAll(classes, ["bg-seg", "[box-shadow:var(--seg-sh)]", "text-foreground", "font-semibold"], "the chosen segment (SEG_ON: the HTML's exact seg-sh, text, 600)");
    else hasAll(classes, ["bg-transparent", "text-muted-foreground", "font-medium"], `segment ${i + 1} (SEG_OFF, text-2, 500)`);
  });
  const staff = renderToStaticMarkup(
    createElement(RangeBar, { variant: "dashboard", value: { preset: "today", range: presetRange("today") }, onChange: noop, isAdmin: false }),
  );
  assert.deepEqual(
    (staff.match(/<button[^>]*>[^<]*<\/button>/g) ?? []).map((b) => />([^<]*)</.exec(b)?.[1]),
    ["Today", "Yesterday", "Pick a day"],
    "staff: one day at a time",
  );
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
  assert.ok(empty.includes('<p class="text-[13.5px] font-medium">None</p>'), "the empty title 13.5/500");
  assert.ok(empty.includes('<p class="max-w-xs text-[12.5px] text-subtle-foreground">Nothing yet.</p>'), "the empty description 12.5 text-3");
  assert.ok(card({ variant: "dashboard", updating: true }).includes("opacity-55"), "the old range's body dims while the new one loads");
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
  for (const f of ["TodayReservations", "RecentOrders"]) {
    const src = readSrc(`components/dashboard/${f}.tsx`);
    assert.ok(!raw.test(src), `${f} has no raw palette class`);
    assert.ok(src.includes("StatusPill"), `${f} uses StatusPill`);
  }
  assert.ok(readSrc("components/dashboard/RecentOrders.tsx").includes("PAY_PILL_KIND"), "recent orders pills use PAY_PILL_KIND");
  assert.ok(readSrc("components/dashboard/TodayReservations.tsx").includes("RESERVATION_KIND"), "reservations use RESERVATION_KIND");
  assert.ok(readSrc("components/dashboard/RankedList.tsx").includes("bg-brand-primary/85 "), "the default bar class stays (brand-contrast pin)");
  const floor = readSrc("components/dashboard/LiveFloorPanel.tsx");
  assert.ok(floor.includes("TABLE_STATUS_META") && !/bg-(green|red|amber)-500/.test(floor), "the floor panel keeps TABLE_STATUS_META");
});

test("PaymentMixCard: a stacked bar with one segment per mode and a dot per row; ChannelsCard colours each bar by channel", async () => {
  const { PaymentMixCard, ChannelsCard } = await import("@/components/dashboard/RangeCards");
  const pay = renderToStaticMarkup(
    createElement(PaymentMixCard, ready({
      payments: [
        { key: "Cash", label: "Cash", count: 3, amount: 600, share: 0.6 },
        { key: "Online", label: "UPI / Online", count: 2, amount: 400, share: 0.4 },
      ],
    })),
  );
  assert.ok(pay.includes("bg-status-ok") && pay.includes("bg-status-info"), "Cash is ok-coloured and Online info-coloured");
  assert.ok(pay.includes("width:60%") && pay.includes("width:40%"), "each segment's width is its share");
  assert.ok(pay.includes("₹1,000"), "the total shows above the bar");
  const ch = renderToStaticMarkup(
    createElement(ChannelsCard, ready({
      channels: [
        { key: "dine-in", label: "Dine-in", count: 3, amount: 600, share: 0.6 },
        { key: "takeaway", label: "Takeaway", count: 2, amount: 400, share: 0.4 },
      ],
    })),
  );
  assert.ok(ch.includes("bg-status-info") && ch.includes("bg-status-warn"), "dine-in info bar, takeaway warn bar");
});

test("PaymentMixCard reserves its header's height, and mixSegments handles zero, one mode and rounding", async () => {
  const { MIX_HEADER_PX, PAYMENT_BODY_MIN_PX, mixSegments } = await import("@/components/dashboard/RangeCards");
  const { RANKED_ROW_PX } = await import("@/components/dashboard/RankedList");
  assert.ok(MIX_HEADER_PX >= 60, "the total line and the bar take about 60 px");
  assert.equal(PAYMENT_BODY_MIN_PX, 3 * RANKED_ROW_PX + MIX_HEADER_PX, "the reserved body height includes the header, so loading and empty hold the loaded height");
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
