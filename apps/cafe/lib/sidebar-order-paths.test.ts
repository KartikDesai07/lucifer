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

test("PIN: Service lists New Order, Orders, Floor, Order Requests, Kitchen, Reservations in that order; Floor is a plain exact row open to every role", () => {
  const rows = rowsOf(readSrc(APP_SIDEBAR), "Service");
  assert.deepEqual(
    rows.map((r) => r.title),
    ["New Order", "Orders", "Floor", "Order Requests", "Kitchen", "Reservations"],
  );
  const floor = rows[2];
  assert.equal(floor.url, "/tables");
  assert.equal(floor.icon, "LayoutGrid");
  assert.equal(floor.exact, true, "Floor must light on exactly /tables, never on Setup / QR codes");
  assert.equal(floor.adminOnly, false, "every role sees the Floor");
});

test("PIN: Manage's Tables row is the admin-only Setup / QR drop-down with its own icon (not the Floor's)", () => {
  const src = readSrc(APP_SIDEBAR);
  const tables = rowsOf(src, "Manage").find((r) => r.title === "Tables");
  assert.ok(tables, "landmark: Manage still has a Tables row");
  assert.equal(tables.url, "/tables/setup");
  assert.equal(tables.adminOnly, true, "staff no longer see a Tables row (the Floor is in Service)");
  assert.equal(tables.icon, "Armchair");
  assert.ok(!src.includes('case "/tables":'), "the Floor row goes through the plain-Link path, never the Tables group");
  // The element's own text up to its self-closing "/>" (a `[^>]*` scan would stop at the ">" of any "=>" prop).
  const at = src.indexOf("<SidebarTablesGroup");
  assert.ok(at >= 0 && src.indexOf("<SidebarTablesGroup", at + 1) < 0, "landmark: exactly one <SidebarTablesGroup> call");
  const element = src.slice(at, src.indexOf("/>", at));
  assert.ok(element.includes("pathname={pathname}"), "landmark: the slice holds the group's own props");
  assert.ok(!/\bisAdmin\b/.test(element), "the group no longer takes isAdmin (it is admin only)");
});

test("PIN: Admin lists Staff, Reports, Printer setup, Settings in that order; Printer setup is an admin-only plain row to /printers", () => {
  const rows = rowsOf(readSrc(APP_SIDEBAR), "Admin");
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Staff", "Reports", "Printer setup", "Settings"],
  );
  const printer = rows[2];
  assert.equal(printer.url, "/printers");
  assert.equal(printer.icon, "Printer");
  assert.equal(printer.adminOnly, true);
  assert.equal(rows[3].url, "/settings", "Settings stays the row right below Printer setup");
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
