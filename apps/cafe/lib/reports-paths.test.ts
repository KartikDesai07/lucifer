// Source pins for the Reports redesign (Batch 1 — sales, payments, dues; see
// .claude/plan/v2/_research/reports-redesign/00-PLAN.md). Same readSrc idiom
// as lib/dashboard-paths.test.ts: needles built so this file can never match
// itself, comments stripped so a comment merely describing a rule can't
// satisfy the pin meant to enforce it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { REPORT_SECTIONS, reportSectionPath } from "@/lib/report-sections";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const absOf = (rel: string) => path.join(HERE, "..", rel);
const readSrc = (rel: string) => stripComments(readFileSync(absOf(rel), "utf8"));

const SIDEBAR_REPORTS_GROUP = "components/layout/SidebarReportsGroup.tsx";
const SALES_ROUTE = "app/api/reports/sales/route.ts";
const DUES_ROUTE = "app/api/reports/dues/route.ts";
const ITEMS_ROUTE = "app/api/reports/items/route.ts";
const ITEM_DETAIL_ROUTE = "app/api/reports/items/detail/route.ts";
const CANCELS_ROUTE = "app/api/reports/cancels/route.ts";
const GST_ROUTE = "app/api/reports/gst/route.ts";
const REPORT_CHART = "components/reports/ReportChart.tsx";

test("PIN: every REPORT_SECTIONS slug has app/(dashboard)/reports/<slug>/page.tsx on disk", () => {
  assert.ok(REPORT_SECTIONS.length > 0, "the section list itself must not be empty");
  for (const section of REPORT_SECTIONS) {
    const pagePath = absOf(`app/(dashboard)/reports/${section.slug}/page.tsx`);
    assert.ok(existsSync(pagePath), `${section.slug} must have a page.tsx at ${pagePath}`);
  }
});

test("PIN: SidebarReportsGroup reads REPORT_SECTIONS (not a hand-copied list)", () => {
  const src = readSrc(SIDEBAR_REPORTS_GROUP);
  assert.match(src, /import\s*\{[^}]*\bREPORT_SECTIONS\b[^}]*\}\s*from\s*"@\/lib\/report-sections"/, "must import REPORT_SECTIONS from @/lib/report-sections");
  assert.match(src, /REPORT_SECTIONS\.map\(/, "must actually iterate REPORT_SECTIONS to render the sub-menu rows");
});

test("PIN: every report route calls requireAdmin() — reporting data is admin-only", () => {
  for (const rel of [SALES_ROUTE, DUES_ROUTE, ITEMS_ROUTE, ITEM_DETAIL_ROUTE, CANCELS_ROUTE, GST_ROUTE]) {
    assert.ok(existsSync(absOf(rel)), `landmark: ${rel} must exist`);
    const src = readSrc(rel);
    assert.match(src, /requireAdmin\(\)/, `${rel} must call requireAdmin()`);
    assert.match(src, /if\s*\(\s*"error"\s+in\s+authed\s*\)\s*return\s+authed\.error;/, `${rel} must return the guard's error response on failure`);
  }
});

test("PIN: every report page that uses ReportChart imports it only through next/dynamic(..., { ssr: false })", () => {
  const staticImport = "from " + '"@/components/reports/ReportChart"';
  const dynamicCall = 'dynamic(() => import("@/components/reports/ReportChart")';
  let sawDynamicImport = false;
  for (const section of REPORT_SECTIONS) {
    const rel = `app/(dashboard)/reports/${section.slug}/page.tsx`;
    if (!existsSync(absOf(rel))) continue;
    const src = readSrc(rel);
    if (!src.includes(dynamicCall)) continue; // this section's page has no chart (e.g. dues)
    sawDynamicImport = true;
    assert.ok(!src.includes(staticImport), `${rel} must not import ReportChart statically`);
    const callIdx = src.indexOf(dynamicCall);
    const afterCall = src.slice(callIdx, callIdx + 400);
    assert.match(afterCall, /ssr:\s*false/, `${rel}: ReportChart's dynamic() must set ssr: false`);
  }
  assert.ok(sawDynamicImport, "landmark: at least one report page must actually import ReportChart via dynamic()");
  assert.ok(existsSync(absOf(REPORT_CHART)), "landmark: components/reports/ReportChart.tsx must exist");
});

const CAFE_NAME_NEEDLE = "lucifer";

test("PIN: no cafe name is written into any Reports screen's code", () => {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(absOf(rel))) {
      const childRel = `${rel}/${entry}`;
      const stat = statSync(absOf(childRel));
      if (stat.isDirectory()) walk(childRel);
      else if (/\.tsx?$/.test(entry)) files.push(childRel);
    }
  };
  walk("app/(dashboard)/reports");
  walk("components/reports");
  assert.ok(files.length >= REPORT_SECTIONS.length, `expected to find at least ${REPORT_SECTIONS.length} report files, found ${files.length}`);
  for (const rel of files) {
    const src = readSrc(rel).toLowerCase();
    assert.ok(!src.includes(CAFE_NAME_NEEDLE), `${rel} must not hardcode a cafe name`);
  }
});

test("landmark: reportSectionPath builds the same paths the sidebar and the page-existence pin both rely on", () => {
  assert.equal(reportSectionPath("sales"), "/reports/sales");
  assert.equal(reportSectionPath("payments"), "/reports/payments");
  assert.equal(reportSectionPath("items"), "/reports/items");
  assert.equal(reportSectionPath("cancels"), "/reports/cancels");
  assert.equal(reportSectionPath("gst"), "/reports/gst");
  assert.equal(reportSectionPath("dues"), "/reports/dues");
});

test("PIN: /reports opens the first report through a next.config redirect (no index page to stream a blank 200)", () => {
  const config = readSrc("next.config.ts");
  const first = reportSectionPath(REPORT_SECTIONS[0].slug);
  assert.ok(config.includes("async redirects()"), "landmark: next.config.ts defines redirects()");
  // Mutation this catches: pointing the redirect at a report that is no longer
  // first (or no longer exists) after REPORT_SECTIONS is reordered.
  assert.match(config, new RegExp(String.raw`\{\s*source:\s*"/reports",\s*destination:\s*"` + first + String.raw`",\s*permanent:\s*false\s*\}`));
  // A page.tsx at /reports would be dead (the redirect answers first) — and the
  // redirect() it held rendered a blank page under the client layout.
  assert.ok(!existsSync(absOf("app/(dashboard)/reports/page.tsx")), "no index page under /reports");
});
