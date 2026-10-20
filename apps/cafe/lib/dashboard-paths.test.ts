import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// Dashboard redesign (2026-09-29) — source pins for the contracts this screen
// makes that no unit test can see: the owner's "recent orders max 5", Chart.js
// staying off the dashboard (its chart is CSS), the live strip riding the realtime nudges,
// the admin-only multi-day rule, and no cafe name in the screen's code.
// Needles are built by concatenation so this file can never match itself.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => stripComments(readFileSync(path.join(HERE, "..", rel), "utf8"));
const PAGE = "app/(dashboard)/page.tsx";
const CARDS = "components/dashboard/RangeCards.tsx";

test("Recent orders shows at most five rows and links to the full Orders list", () => {
  const src = readSrc("components/dashboard/RecentOrders.tsx");
  assert.match(src, /const MAX_ROWS = 5;/, "MAX_ROWS must be 5 (owner: recent orders max 5)");
  assert.ok(src.includes("orders.slice(0, MAX_ROWS)"), "the rows must be cut to MAX_ROWS");
  // U0 match Task 8 (ruling R17): the HTML's words for the link, "All orders →".
  assert.ok(src.includes('link={{ href: "/orders", label: "All orders" }}'), "an All orders link to /orders");
});

// U0 match Task 7 (values 3.5, design 5.5): the dashboard's sales chart is the owner's HTML bar chart in CSS
// (components/dashboard/HourBars.tsx), so SalesChart and its chart-size module are gone and the Reports' ReportChart
// is the one file left that may import Chart.js / react-chartjs-2 (still through next/dynamic, reports-paths.test.ts).
test("the dashboard draws its sales chart in CSS; only the Reports' ReportChart imports Chart.js", () => {
  const cards = readSrc(CARDS);
  assert.ok(cards.includes('from "@/components/dashboard/HourBars"'), "landmark: SalesCard draws HourBars");
  assert.ok(!cards.includes("next/dynamic"), "no lazy chart chunk left on the cards");
  for (const gone of ["components/dashboard/SalesChart.tsx", "components/dashboard/chart-size.ts"]) {
    assert.ok(!existsSync(path.join(HERE, "..", gone)), `${gone} is deleted (nothing imports it)`);
  }
  const needles = ['from "' + "chart.js" + '"', 'from "' + "react-chartjs-2" + '"'];
  const dirs = ["components", "app", "hooks", "lib"];
  const ALLOWED_CHARTJS_FILES = ["components/reports/ReportChart.tsx"];
  const offenders: string[] = [];
  let scanned = 0;
  const walk = (rel: string) => {
    for (const entry of readdirSync(path.join(HERE, "..", rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
        scanned += 1;
        const src = readSrc(child);
        if (needles.some((n) => src.includes(n)) && !ALLOWED_CHARTJS_FILES.includes(child)) offenders.push(child);
      }
    }
  };
  for (const d of dirs) walk(d);
  assert.ok(scanned > 100, `scanned ${scanned} source files — the walk must actually cover the app`);
  assert.ok(readSrc("components/reports/ReportChart.tsx").includes(needles[1]), "landmark: ReportChart does use react-chartjs-2");
  assert.deepEqual(offenders, [], "no other file imports Chart.js");
});

test("the live strip refetches on the order and QR nudges — through its OWN spec, mounted by the page", () => {
  const src = readSrc("hooks/use-realtime.ts");
  const start = src.indexOf("export const DASHBOARD_REALTIME");
  assert.ok(start > 0, "DASHBOARD_REALTIME is declared");
  const spec = src.slice(start, src.indexOf("export function useDashboardRealtime"));
  const target = "targets: [{ queryKey: " + "DASHBOARD_KEYS.live }]";
  assert.ok(spec.includes(target), "DASHBOARD_REALTIME targets exactly DASHBOARD_KEYS.live");
  assert.ok(
    src.includes("DASHBOARD_EVENT_KINDS = [..." + "LIVE_STATE_EVENT_KINDS, ...PULSE_EVENT_KINDS]"),
    "open tabs (kot-fired / order-changed) and QR orders waiting (self-order) both nudge it",
  );
  assert.ok(src.includes("useRealtimeInvalidate(" + "DASHBOARD_EVENT_KINDS, DASHBOARD_REALTIME)"), "the hook subscribes it");
  // The shared specs keep their pinned targets: the pulse must never ride an
  // order nudge (a pulse refetch makes the print host beat).
  const pulse = src.slice(src.indexOf("export const PULSE_REALTIME"), src.indexOf("export const LIVE_STATE_REALTIME"));
  assert.ok(pulse.includes("POS_PULSE_KEYS.all"), "landmark: the pulse spec located");
  assert.ok(!pulse.includes("DASHBOARD_KEYS"), "the pulse spec is untouched");
  assert.ok(readSrc(PAGE).includes("useDashboardRealtime" + "();"), "the dashboard page mounts it");
});

test("more than one day is admin-only on the server", () => {
  const src = readSrc("app/api/dashboard/route.ts");
  assert.ok(src.includes("requireAuth()"), "signed-in users only");
  assert.ok(
    src.includes('range.from !== range.to && authed.session.user.role !== "admin"'),
    "a multi-day range from a non-admin is refused",
  );
  assert.ok(src.includes('failure("Only an admin can view more than one day", 403)'), "…with a 403");
});

test("the dashboard's figures come from the server aggregate, never a capped list", () => {
  const page = readSrc(PAGE);
  assert.ok(page.includes("useDashboard(range, restored)"), "the range figures read GET /api/dashboard, once the stored period is restored");
  assert.ok(page.includes("useDashboardLive()"), "the strip reads GET /api/dashboard/live");
  assert.ok(!page.includes("useOrderSummary" + "("), "the page no longer sums the day summary itself");
});

test("no cafe name is written into the dashboard's code", () => {
  const files = [
    PAGE,
    CARDS,
    ...readdirSync(path.join(HERE, "..", "components/dashboard")).map((f) => `components/dashboard/${f}`),
  ];
  // U0 match Task 5: the page's title row moved into the shell's header, whose second line names the cafe from
  // Settings when the page gives no description (the HTML's "{cafe} · {weekday, day month}").
  assert.ok(/<PageHeader\s+title="Dashboard"/.test(readSrc(PAGE)), "landmark: the page names itself through PageHeader");
  assert.ok(!/<PageHeader[^>]*\bdescription=/.test(readSrc(PAGE)), "with no description, so the header's cafe line shows");
  assert.ok(readSrc("components/layout/Header.tsx").includes("settings.data?.restaurantName"), "landmark: the header names the cafe from Settings");
  for (const rel of files) {
    assert.ok(!/lucifer/i.test(readSrc(rel)), `${rel} must not hardcode a cafe name`);
  }
});

// U0 match Task 8, fix round 1: the dashboard's cards read an order's channel from lib/dashboard/channel.ts (the JS twin
// of CHANNEL_EXPR), never from the server's aggregation module, which no client file may import.
test("channelOf lives in lib/dashboard/channel.ts; no component, hook or page imports lib/dashboard/pipelines", () => {
  const root = path.join(HERE, "..");
  const walk = (dir: string): string[] =>
    readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) return rel.split(path.sep).includes("api") ? [] : walk(rel);
      return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
    });
  const needle = "@/lib/dashboard/" + "pipelines";
  const offenders = ["components", "hooks", "app"].flatMap(walk).filter((f) => readSrc(f).includes(needle));
  assert.deepEqual(offenders, [], "client code reads the channel from lib/dashboard/channel.ts");
  assert.match(readSrc("components/dashboard/RecentOrders.tsx"), /import \{ channelOf \} from "@\/lib\/dashboard\/channel";/, "Recent orders' channel");
  const channel = readSrc("lib/dashboard/channel.ts");
  assert.ok(/export function channelOf\(/.test(channel), "the twin is defined there");
  assert.ok(!/from "mongoose"|from "@\/models|from "@\/lib\/db/.test(channel), "and imports nothing of the server");
  assert.ok(readSrc("lib/dashboard/pipelines.ts").includes('export { channelOf } from "@/lib/dashboard/channel";'), "pipelines.ts re-exports it for the scripts and tests");
});
