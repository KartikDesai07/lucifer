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
const HEADER = read("components/layout/Header.tsx");
const TABS = read("components/layout/HeaderQuickTabs.tsx");
const BAND = read("components/orders/RequestAlertBar.tsx");
const PRINTER = read("components/print/PrinterStatusButton.tsx");

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
    "data-[active=true]:font-semibold",
    "data-[active=true]:shadow-[inset_3px_0_0_var(--color-brand-accent)]",
    "pointer-coarse:h-11",
    "h-8",
  ]) {
    assert.ok(all.split(/\s+/).includes(needle), `the nav row classes must carry the exact token ${needle}`);
  }
  // The 17-row list plus four headings must fit a 768px laptop screen (measured on the built app: h-9 rows
  // scrolled the list at 1366x768, scrollHeight 720 vs clientHeight 647, and hid Settings at 1280x800).
  for (const taller of ["h-9", "h-[38px]"]) {
    assert.ok(!all.split(/\s+/).includes(taller), `the nav row must not be ${taller}: the list has to fit 768px`);
  }
});

test("the section heading is a small uppercase muted label that folds away in the rail", () => {
  const label = literal("BRAND_NAV_LABEL_CLASS");
  for (const needle of [
    "h-6",
    "uppercase",
    "text-[11px]",
    "tracking-[0.06em]",
    "text-brand-nav-muted",
    "group-data-[collapsible=icon]:-mt-6",
    "group-data-[collapsible=icon]:pointer-events-none",
  ]) {
    assert.ok(label.split(/\s+/).includes(needle), `BRAND_NAV_LABEL_CLASS must carry the exact token ${needle}`);
  }
  for (const taller of ["h-9", "h-[38px]"]) {
    assert.ok(!label.split(/\s+/).includes(taller), `the heading must not be ${taller}: the list has to fit 768px`);
  }
});

test("the sidebar brand has no multiply blend (it misrenders on dark) and puts the logo on a white tile", () => {
  assert.ok(!BRAND.includes("mix-blend-multiply"), "mix-blend-multiply must be gone from SidebarBrand");
  assert.match(BRAND, /bg-white/, "the logo must sit on a white tile");
});

test("the sidebar's scrollbar colour reads the nav rule token", () => {
  assert.match(SIDEBAR, /scrollbar-color:var\(--brand-nav-rule\)/, "AppSidebar's scrollbar must use --brand-nav-rule");
});

test("the active sidebar row is weight 600 and never repeats font-medium in NAV_ACTIVE", () => {
  const active = CLASSES.match(/const NAV_ACTIVE =\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(!active.includes("font-medium"), "NAV_ACTIVE must not repeat font-medium (a no-op)");
});

test("the top bar is a white 56px bar with a bottom rule, sticky", () => {
  const tag = HEADER.match(/<header className="([^"]*)"/)?.[1] ?? "";
  for (const needle of ["sticky", "top-0", "h-14", "border-b", "bg-card"]) {
    assert.ok(tag.split(/\s+/).includes(needle), `the header tag must carry ${needle}`);
  }
  assert.ok(!/bg-background/.test(tag), "the header must not be the translucent page colour any more");
});

test("a quick tab keeps min-w-0 and shrink and lights with the accent tint when active", () => {
  const cls = TABS.match(/const TAB_CLASS =\s*([\s\S]*?);\n/)?.[1] ?? "";
  for (const needle of ["min-w-0", "shrink", "data-[active=true]:bg-accent", "data-[active=true]:text-accent-foreground"]) {
    assert.ok(cls.split(/\s+/).includes(needle), `TAB_CLASS must carry the exact token ${needle}`);
  }
  assert.ok(!/brand-primary-soft/.test(cls), "TAB_CLASS must not keep the old brand tint");
});

test("the request band is the warn tint with warn ink, on the observed element", () => {
  assert.match(BAND, /<div[^>]*ref=\{bandRef\}[^>]*bg-status-warn-tint[^>]*text-status-warn-ink/, "band tag colours");
  assert.ok(!/amber/.test(BAND), "no amber palette class may remain in the band");
});

test("the printer button is the outline square", () => {
  assert.match(PRINTER, /variant="outline"/, "PrinterStatusButton must use the outline variant");
});

test("the account row reads on dark: white name, muted role, and an avatar with the online dot", () => {
  assert.match(ACCOUNT, /text-brand-slip/, "the account name must be text-brand-slip");
  assert.match(ACCOUNT, /text-brand-nav-muted/, "the role must be text-brand-nav-muted");
  assert.match(ACCOUNT, /<StaffAvatar[^>]*status="online"/, "the trigger must show a StaffAvatar with status online");
});
