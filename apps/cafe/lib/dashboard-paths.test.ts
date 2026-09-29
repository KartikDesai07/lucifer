import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";

// Dashboard redesign (2026-09-29) — source pins for the contracts this screen
// makes that no unit test can see: the owner's "recent orders max 5", Chart.js
// staying out of the first bundle, the live strip riding the realtime nudges,
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
  assert.ok(src.includes('link={{ href: "/orders", label: "View all" }}'), "a View all link to /orders");
});

test("Chart.js reaches the page only through a dynamic, client-only import", () => {
  const cards = readSrc(CARDS);
  assert.ok(cards.includes('dynamic(() => import("@/components/dashboard/SalesChart")'), "SalesChart is next/dynamic");
  assert.match(cards, /ssr: false/, "…with ssr: false");
  const staticImport = "from " + '"@/components/dashboard/SalesChart"';
  for (const rel of [PAGE, CARDS]) {
    const src = readSrc(rel);
    assert.ok(src.includes("@/components/dashboard/"), `${rel}: landmark (dashboard imports present)`);
    assert.ok(!src.includes(staticImport), `${rel} must not import SalesChart statically`);
  }
  // Only SalesChart and the Reports screens' own ReportChart may import
  // chart.js / react-chartjs-2 (Reports redesign Batch 1, 2026-09-29 —
  // ReportChart is the Reports screens' chart, same kit, allow-listed
  // alongside SalesChart rather than replacing it).
  const needles = ['from "' + "chart.js" + '"', 'from "' + "react-chartjs-2" + '"'];
  const dirs = ["components", "app", "hooks", "lib"];
  const ALLOWED_CHARTJS_FILES = ["components/dashboard/SalesChart.tsx", "components/reports/ReportChart.tsx"];
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
  assert.ok(readSrc("components/dashboard/SalesChart.tsx").includes(needles[1]), "landmark: SalesChart does use react-chartjs-2");
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
  assert.ok(readSrc(PAGE).includes("restaurantName"), "landmark: the page names the cafe from Settings");
  for (const rel of files) {
    assert.ok(!/lucifer/i.test(readSrc(rel)), `${rel} must not hardcode a cafe name`);
  }
});
