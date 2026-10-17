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
import { AttentionStrip } from "@/components/dashboard/AttentionStrip";
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
/** An arbitrary rgb() colour with an alpha (Tailwind's underscores for spaces) laid over an opaque hex, flattened to hex. */
function over(rgba: string, base: string): string {
  const m = /^rgb\((\d+)_(\d+)_(\d+)\/([\d.]+)\)$/.exec(rgba);
  assert.ok(m, `"${rgba}" is an arbitrary rgb() value with an alpha`);
  const a = Number(m[4]);
  const out = [1, 2, 3].map((i) => {
    const b = parseInt(base.slice(1 + (i - 1) * 2, 3 + (i - 1) * 2), 16);
    return Math.round(a * Number(m[i]) + (1 - a) * b).toString(16).padStart(2, "0");
  });
  return `#${out.join("")}`;
}

// ── the arrangement ─────────────────────────────────────────────────────────

test("the page lays every card out in the mock-up's order, and no longer renders the KPI row", () => {
  const page = readSrc(PAGE);
  const ORDER = [
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
    "<TopItemsCard",
    "<SlowItemsCard",
    "<CategoriesCard",
    "<LeaksCard",
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
  assert.ok(page.includes("<EndOfDayButton />"), "landmark: the End of day button stays in the head");
  assert.ok(
    page.includes("xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"),
    "the hero row is the dark card beside the receipt from xl (at 1024 the content is ~720px: stacked reads better)",
  );
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

test("AttentionStrip keeps the five chips, their words, links and order; a phone folds them behind one button", () => {
  const src = readSrc("components/dashboard/AttentionStrip.tsx");
  for (const needle of [
    '`${plural(live.pendingRequests, "QR order")} waiting`',
    '`${plural(live.openTabs.count, "open tab")} · ${inr(live.openTabs.value)}`',
    '`${plural(live.bookingsToday, "booking")} today`',
    '`${plural(live.unavailable.count, "item")} unavailable`',
    '`${inr(live.dues.total)} due from ${plural(live.dues.customers, "customer")}`',
  ]) {
    assert.ok(src.includes(needle), `the strip still builds ${needle}`);
  }
  assert.ok(src.includes("aria-expanded"), "the phone's summary row is a disclosure button");

  const html = renderToStaticMarkup(createElement(AttentionStrip, { live: LIVE, loading: false, isError: false }));
  assert.ok(html.includes('aria-label="Needs attention"'), "the section keeps its name");
  const chips: Array<[string, string]> = [
    ["1 QR order waiting", "/requests"],
    ["2 open tabs · ₹1,450", "/orders?payment=Unpaid&amp;status=Pending"],
    ["4 bookings today", "/reservations"],
    ["3 items unavailable", menuItemsHref({ status: "out-of-stock" }).replace(/&/g, "&amp;")],
    ["₹8,450 due from 6 customers", "/customers"],
  ];
  let last = -1;
  for (const [text, href] of chips) {
    const at = html.indexOf(text);
    assert.ok(at > last, `"${text}" is shown, after the chip before it`);
    const link = html.lastIndexOf("<a ", at);
    assert.ok(html.slice(link, at).includes(`href="${href}"`), `"${text}" links to ${href}`);
    assert.equal(html.split(`href="${href}"`).length - 1, 2, `${href} is linked twice: the desktop chip and the phone row`);
    last = at;
  }
  const controls = /aria-controls="([^"]+)"/.exec(html)?.[1];
  assert.ok(controls, "the disclosure button names the list it opens");
  assert.ok(html.includes(`<ul id="${controls}"`), "aria-controls equals the list's id");
  assert.ok(html.includes("pointer-coarse:min-h-11"), "the desktop row grows to the 44 px chips on touch, so the strip does not jump");
  const skeleton = renderToStaticMarkup(createElement(AttentionStrip, { loading: true, isError: false }));
  assert.equal((skeleton.match(/h-\[34px\][^"]*pointer-coarse:h-11/g) ?? []).length, 3, "the three chip skeletons are 44 px on touch too");
  assert.ok(html.includes('title="Cold coffee, Brownie and 1 more"'), "the unavailable chip names the items");
  assert.ok(html.includes('aria-expanded="false"'), "the phone's list starts folded");
  assert.match(html, /aria-expanded="false"[^>]*>[\s\S]*?>5<[\s\S]*?Needs attention/, "the phone's row says 5 · Needs attention");
  for (const dot of ["bg-status-warn", "bg-status-info", "bg-status-reserved", "bg-status-bad", "bg-status-bill"]) {
    assert.ok(html.includes(dot), `a ${dot} dot marks its chip`);
  }

  const clear = renderToStaticMarkup(
    createElement(AttentionStrip, {
      live: { openTabs: { count: 0, value: 0 }, pendingRequests: 0, dues: { total: 0, customers: 0 }, unavailable: { count: 0, names: [] }, bookingsToday: 0 },
      loading: false,
      isError: false,
    }),
  );
  assert.ok(clear.includes("All clear — nothing needs attention right now."), "the all-clear line stays");
  assert.ok(!clear.includes("aria-expanded"), "nothing to fold when nothing needs attention");
  const loading = renderToStaticMarkup(createElement(AttentionStrip, { loading: true, isError: false }));
  assert.ok(loading.includes("animate-pulse") && !loading.includes("All clear"), "skeletons while the counts load");
  const failed = renderToStaticMarkup(createElement(AttentionStrip, { loading: false, isError: true }));
  assert.ok(failed.includes("load the live counts. Trying again…"), "the error line stays");
});

// ── the period picker ───────────────────────────────────────────────────────

test("RangeBar: the segmented look keeps the Period group, its words and one pressed choice, 44 px on touch", () => {
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
