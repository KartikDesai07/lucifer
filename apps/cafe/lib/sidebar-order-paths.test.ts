// Source pins for the 2026-10-02 sidebar re-order (owner): the Floor sits right
// under New Order and Orders, and Printer setup moved OUT of Settings into its
// own Admin row directly above Settings (page at /printers). Read the REAL
// source, comments stripped — same technique as sidebar-paths.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ADMIN_ROUTES } from "@/lib/constants";
import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const absOf = (rel: string): string => path.join(REPO_ROOT, rel);
const readSrc = (rel: string): string => stripComments(readFileSync(absOf(rel), "utf8"));

const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const NEXT_CONFIG = "apps/cafe/next.config.ts";
const PRINTERS_PAGE = "apps/cafe/app/(dashboard)/printers/page.tsx";
const OLD_PRINTING_PAGE = "apps/cafe/app/(dashboard)/settings/printing/page.tsx";

interface Row {
  title: string;
  url: string;
  icon: string;
  adminOnly: boolean;
  exact: boolean;
}

/** The nav rows of one `label: "<label>"` section, in source order. */
function rowsOf(src: string, label: string): Row[] {
  const start = src.indexOf(`label: "${label}"`);
  assert.ok(start >= 0, `landmark: the ${label} section exists`);
  const next = src.indexOf("label:", start + 1);
  const body = src.slice(start, next < 0 ? undefined : next);
  return [...body.matchAll(/\{\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*icon:\s*(\w+)([^}]*)\}/g)].map((m) => ({
    title: m[1],
    url: m[2],
    icon: m[3],
    adminOnly: /adminOnly:\s*true/.test(m[4]),
    exact: /exact:\s*true/.test(m[4]),
  }));
}

// U0 Task 2 (2026-10-19, design 5.2): the owner's HTML has two groups, Operate and Manage, with the HTML's words
// ("Home", "Order"); our extra screens sit in the group the design names, in its order.
test("PIN: the nav has the HTML's two groups, Operate then Manage, and no other", () => {
  const labels = [...readSrc(APP_SIDEBAR).matchAll(/label:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Operate", "Manage"], "the group labels are the HTML's Operate and Manage, in that order");
});

test("PIN: Operate lists Home, Floor, Order, Orders, Order Requests, Kitchen, Now Serving, Reservations; Floor is a plain exact row open to every role", () => {
  const rows = rowsOf(readSrc(APP_SIDEBAR), "Operate");
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Home", "Floor", "Order", "Orders", "Order Requests", "Kitchen", "Now Serving", "Reservations"],
    "Operate's rows in the design's order, with the HTML's words Home and Order",
  );
  assert.deepEqual(
    rows.map((r) => r.url),
    ["/", "/tables", "/pos", "/orders", "/requests", "/kitchen", "/now-serving", "/reservations"],
    "Home opens the dashboard, Floor the floor, Order the POS",
  );
  const floor = rows[1];
  assert.equal(floor.exact, true, "Floor must light on exactly /tables, never on Setup / QR codes");
  assert.equal(floor.adminOnly, false, "every role sees the Floor");
  assert.ok(rows.every((r) => !r.adminOnly), "every Operate row is open to every role");
});

test("PIN: Manage lists Menu, Tables, Customers, Expenses, Events, Staff, Reports, Printer setup, Settings", () => {
  const rows = rowsOf(readSrc(APP_SIDEBAR), "Manage");
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Menu", "Tables", "Customers", "Expenses", "Events", "Staff", "Reports", "Printer setup", "Settings"],
    "Manage's rows in the design's order",
  );
  assert.deepEqual(
    rows.filter((r) => r.adminOnly).map((r) => r.title),
    ["Tables", "Staff", "Reports", "Printer setup", "Settings"],
    "the owner's tools stay admin-only",
  );
});

test("PIN: Manage's Tables row is the admin-only Setup / QR drop-down with its own icon (not the Floor's)", () => {
  const src = readSrc(APP_SIDEBAR);
  const tables = rowsOf(src, "Manage").find((r) => r.title === "Tables");
  assert.ok(tables, "landmark: Manage still has a Tables row");
  assert.equal(tables.url, "/tables/setup");
  assert.equal(tables.adminOnly, true, "staff no longer see a Tables row (the Floor is in Operate)");
  assert.equal(tables.icon, "Armchair");
  const floor = rowsOf(src, "Operate").find((r) => r.title === "Floor");
  assert.ok(floor && floor.icon !== tables.icon, "the Floor row keeps its own icon");
  assert.ok(!src.includes('case "/tables":'), "the Floor row goes through the plain-Link path, never the Tables group");
  // The element's own text up to its self-closing "/>" (a `[^>]*` scan would stop at the ">" of any "=>" prop).
  const at = src.indexOf("<SidebarTablesGroup");
  assert.ok(at >= 0 && src.indexOf("<SidebarTablesGroup", at + 1) < 0, "landmark: exactly one <SidebarTablesGroup> call");
  const element = src.slice(at, src.indexOf("/>", at));
  assert.ok(element.includes("pathname={pathname}"), "landmark: the slice holds the group's own props");
  assert.ok(!/\bisAdmin\b/.test(element), "the group no longer takes isAdmin (it is admin only)");
});

test("PIN: Printer setup is an admin-only plain row to /printers, right above Settings", () => {
  const rows = rowsOf(readSrc(APP_SIDEBAR), "Manage");
  const at = rows.findIndex((r) => r.title === "Printer setup");
  assert.ok(at >= 0, "landmark: Manage has a Printer setup row");
  const printer = rows[at];
  assert.equal(printer.url, "/printers");
  assert.equal(printer.icon, "Printer");
  assert.equal(printer.adminOnly, true);
  assert.equal(rows[at + 1]?.url, "/settings", "Settings stays the row right below Printer setup");
});

test("PIN: /printers is an ADMIN_ROUTES entry, its page guards itself, and the old /settings/printing route is a redirect, not a page", () => {
  assert.ok((ADMIN_ROUTES as readonly string[]).includes("/printers"), "middleware must send staff home from /printers");
  const page = readSrc(PRINTERS_PAGE);
  assert.equal(page.split("<AdminGuard>").length - 1, 1, "the page renders <AdminGuard> once");
  assert.ok(page.includes('from "@/components/shared/AdminGuard"'), "the guard is the shared component, not a local stand-in");
  assert.ok(page.indexOf("<MenuPageShell>") > page.indexOf("<AdminGuard>"), "AdminGuard outside, brand shell inside");
  assert.ok(!existsSync(absOf(OLD_PRINTING_PAGE)), "the old settings/printing page must be gone");
  const config = readSrc(NEXT_CONFIG);
  assert.match(
    config,
    /\{\s*source:\s*"\/settings\/printing",\s*destination:\s*"\/printers",\s*permanent:\s*false\s*\}/,
    "old bookmarks keep working through a config redirect",
  );
});
