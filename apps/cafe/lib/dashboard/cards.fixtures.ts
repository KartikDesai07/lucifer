// Shared fixtures for the dashboard's range cards' render tests (lib/dashboard-insight-cards.test.ts): one
// DashboardData (Friday 16 Oct, today, against Friday 9 Oct; the insight window the four weeks to today) that a test
// overrides field by field, the RangeCardProps a ready card gets, and the helpers that read a rendered card's
// data-ui elements.
import assert from "node:assert/strict";
import type { DashboardData } from "@/types/dashboard";

export const CARDS_TODAY = "2026-10-16";

export function dashboardFixture(over: Partial<DashboardData> = {}): DashboardData {
  return {
    range: { from: CARDS_TODAY, to: CARDS_TODAY },
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
    // A one-day range reads the four weeks ending today (lib/dashboard/range insightRange).
    heat: { from: "2026-09-19", to: CARDS_TODAY, hours: [], avg: [], max: 0 },
    leaks: {
      cancelled: { count: 0, value: 0 },
      voids: { lines: 0, qty: 0, value: 0 },
      discounts: { orders: 0, amount: 0 },
      rewards: { orders: 0, amount: 0 },
    },
    money: { gross: 0, discount: 0, reward: 0, gst: 0, charges: 0 },
    duesCollected: 0,
    ...over,
  };
}

/** A ready card's props (RangeCardProps) over the fixture. */
export const readyCard = (over: Partial<DashboardData> = {}) => ({
  data: dashboardFixture(over),
  status: "ready" as const,
  updating: false,
  onRetry: () => {},
  period: "Today",
  today: CARDS_TODAY,
});

const TAG = (name: string) => new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g");

/** Every opening tag carrying data-ui="name". */
export const tagsOf = (html: string, name: string): string[] => html.match(TAG(name)) ?? [];
/** The opening tag of the nth element carrying data-ui="name" ("" when there is none). */
export const tagOf = (html: string, name: string, nth = 0): string => tagsOf(html, name)[nth] ?? "";
/** The text right inside each element carrying data-ui="name" (up to its first child tag). */
export const textsOf = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`data-ui="${name}"[^>]*>([^<]*)<`, "g"))].map((m) => m[1]);
export const classesOf = (tag: string): string[] => (/class="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
export const styleOf = (tag: string): string => /style="([^"]*)"/.exec(tag)?.[1] ?? "";

/** Asserts that the tag carries every class, naming the element in the message. */
export function expectClasses(tag: string, classes: string[], label: string): void {
  for (const c of classes) assert.ok(classesOf(tag).includes(c), `${label} has ${c} (got "${classesOf(tag).join(" ")}")`);
}
