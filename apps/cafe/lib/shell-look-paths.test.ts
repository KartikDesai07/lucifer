// The dark sidebar (owner's mock-up, 2026-10-16): the row, heading and account
// styles are source-pinned here, so a restyle cannot quietly drop the active
// bar, the touch height or the readable text colours. The contrast of the
// tokens themselves is measured in lib/brand-contrast.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const CLASSES = read("components/brand/brand-classes.ts");
const BRAND = read("components/layout/SidebarBrand.tsx");
const SIDEBAR = read("components/layout/AppSidebar.tsx");
const ACCOUNT = read("components/layout/SidebarAccount.tsx");

function literal(name: string): string {
  const m = CLASSES.match(new RegExp(`export const ${name} =\\s*"([^"]*)"`));
  assert.ok(m, `${name} must be one string literal`);
  return m![1];
}

test("a nav row is the soft nav text, lifts to the nav-hover fill, and the active row carries the 3px blue bar", () => {
  const all = `${CLASSES.match(/const NAV_ACTIVE =\s*"([^"]*)"/)?.[1] ?? ""} ${literal("BRAND_NAV_ITEM_CLASS")}`;
  for (const needle of [
    "text-brand-nav-text",
    "hover:bg-brand-nav-hover",
    "data-[active=true]:bg-brand-nav-hover",
    "data-[active=true]:text-white",
    "data-[active=true]:shadow-[inset_3px_0_0_var(--color-brand-accent)]",
    "pointer-coarse:h-11",
    "h-9",
  ]) {
    assert.ok(all.includes(needle), `the nav row classes must carry ${needle}`);
  }
});

test("the section heading is a small uppercase muted label that folds away in the rail", () => {
  const label = literal("BRAND_NAV_LABEL_CLASS");
  for (const needle of [
    "uppercase",
    "text-[11px]",
    "tracking-[0.06em]",
    "text-brand-nav-muted",
    "group-data-[collapsible=icon]:-mt-6",
    "group-data-[collapsible=icon]:pointer-events-none",
  ]) {
    assert.ok(label.includes(needle), `BRAND_NAV_LABEL_CLASS must carry ${needle}`);
  }
});

test("the sidebar brand has no multiply blend (it misrenders on dark) and puts the logo on a white tile", () => {
  assert.ok(!BRAND.includes("mix-blend-multiply"), "mix-blend-multiply must be gone from SidebarBrand");
  assert.match(BRAND, /bg-white/, "the logo must sit on a white tile");
});

test("the sidebar's scrollbar colour reads the nav rule token", () => {
  assert.match(SIDEBAR, /scrollbar-color:var\(--brand-nav-rule\)/, "AppSidebar's scrollbar must use --brand-nav-rule");
});

test("the account row reads on dark: white name, muted role, and an avatar with the online dot", () => {
  assert.match(ACCOUNT, /text-brand-slip/, "the account name must be text-brand-slip");
  assert.match(ACCOUNT, /text-brand-nav-muted/, "the role must be text-brand-nav-muted");
  assert.match(ACCOUNT, /<StaffAvatar[^>]*status="online"/, "the trigger must show a StaffAvatar with status online");
});
