// Tables redesign Step 0 — the Tables drop-down's single source of truth
// (lib/table-sections). Pure: no React, no DOM.

import { test } from "node:test";
import assert from "node:assert/strict";

import { ADMIN_ROUTES } from "@/lib/constants";
import {
  TABLES_FLOOR_PATH,
  TABLES_QR_PATH,
  TABLES_SETUP_PATH,
  TABLE_SECTIONS,
  isTablesPath,
  isTableSectionActive,
  visibleTableSections,
} from "@/lib/table-sections";

const adminRoutes: readonly string[] = ADMIN_ROUTES;

test("TABLE_SECTIONS is non-empty and carries the three section hrefs in sidebar order", () => {
  assert.ok(TABLE_SECTIONS.length > 0, "a filtered/empty list would silently hide the whole drop-down");
  assert.deepEqual(
    TABLE_SECTIONS.map((s) => s.href),
    ["/tables", "/tables/setup", "/tables/qr"],
  );
  assert.equal(TABLES_FLOOR_PATH, "/tables");
  assert.equal(TABLES_SETUP_PATH, "/tables/setup");
  assert.equal(TABLES_QR_PATH, "/tables/qr");
  for (const s of TABLE_SECTIONS) assert.ok(s.title.trim().length > 0, `${s.href} needs a title`);
});

test("isTablesPath: the floor and its sub-paths are Tables; look-alike prefixes are not", () => {
  assert.equal(isTablesPath("/tables"), true);
  assert.equal(isTablesPath("/tables/qr"), true);
  assert.equal(isTablesPath("/tables/setup"), true);
  assert.equal(isTablesPath("/tables-x"), false);
  assert.equal(isTablesPath("/table"), false);
  assert.equal(isTablesPath("/"), false);
});

test("isTableSectionActive: Floor lights only on exactly /tables, never on Setup or QR", () => {
  assert.equal(isTableSectionActive("/tables", TABLES_FLOOR_PATH), true);
  assert.equal(isTableSectionActive("/tables/setup", TABLES_FLOOR_PATH), false);
  assert.equal(isTableSectionActive("/tables/qr", TABLES_FLOOR_PATH), false);
  assert.equal(isTableSectionActive("/tables/setup/x", TABLES_FLOOR_PATH), false);
});

test("isTableSectionActive: Setup lights on /tables/setup and its sub-paths, not on the floor or a sibling", () => {
  assert.equal(isTableSectionActive("/tables/setup", TABLES_SETUP_PATH), true);
  assert.equal(isTableSectionActive("/tables/setup/anything", TABLES_SETUP_PATH), true);
  assert.equal(isTableSectionActive("/tables", TABLES_SETUP_PATH), false);
  assert.equal(isTableSectionActive("/tables/qr", TABLES_SETUP_PATH), false);
  assert.equal(isTableSectionActive("/tables/setup-old", TABLES_SETUP_PATH), false);
  assert.equal(isTableSectionActive("/tables/qr", TABLES_QR_PATH), true);
});

test("exactly one section is active on each Tables page", () => {
  for (const p of [TABLES_FLOOR_PATH, TABLES_SETUP_PATH, TABLES_QR_PATH]) {
    const active = TABLE_SECTIONS.filter((s) => isTableSectionActive(p, s.href));
    assert.deepEqual(active.map((s) => s.href), [p]);
  }
});

test("visibleTableSections: staff see Floor only, admin sees all three", () => {
  const staff = visibleTableSections(false);
  assert.deepEqual(staff.map((s) => s.href), ["/tables"]);
  const admin = visibleTableSections(true);
  assert.deepEqual(admin.map((s) => s.href), ["/tables", "/tables/setup", "/tables/qr"]);
});

test("every adminOnly section is an ADMIN_ROUTES entry, and the open Floor route is not", () => {
  // Positive landmark: the guard must have something to guard.
  const adminOnly = TABLE_SECTIONS.filter((s) => s.adminOnly);
  assert.ok(adminOnly.length >= 2, "landmark: Setup and QR must be adminOnly");
  for (const s of adminOnly) {
    assert.ok(adminRoutes.includes(s.href), `${s.href} is adminOnly but missing from ADMIN_ROUTES (middleware would let staff in)`);
  }
  // Reverse: every non-admin section must NOT be admin-gated by middleware.
  for (const s of TABLE_SECTIONS.filter((x) => !x.adminOnly)) {
    assert.ok(!adminRoutes.includes(s.href), `${s.href} is not adminOnly yet is admin-gated`);
  }
  assert.ok(adminRoutes.includes("/tables/setup"), "landmark: ADMIN_ROUTES itself carries the Setup route");
  assert.ok(!adminRoutes.includes("/tables"), "/tables stays open to every role");
});
