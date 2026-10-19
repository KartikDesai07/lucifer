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

// U0 Task 2: the owner's HTML nav (values 2.3), the same sizes on touch screens (plan ruling R1). The old 32px rows
// (kept so 17 rows fit 768px) give way to the HTML's 38px rows; the nav's middle scrolls instead.
test("a nav row is the HTML's: nav-t text, white on nav-on when hovered or active, 8px radius, 60x52 in the rail and 38px wide", () => {
  const all = `${CLASSES.match(/const NAV_ACTIVE =\s*"([^"]*)"/)?.[1] ?? ""} ${literal("BRAND_NAV_ITEM_CLASS")}`;
  const tokens = all.split(/\s+/);
  for (const needle of [
    "text-nav-t",
    "hover:bg-nav-on",
    "hover:text-white",
    "data-[active=true]:bg-nav-on",
    "data-[active=true]:text-white",
    "rounded-[8px]",
    "font-medium",
    "flex-col",
    "gap-1",
    "pt-2",
    "pb-1.5",
    "text-[10.5px]",
    "wide:flex-row",
    "wide:gap-2.5",
    "wide:px-2.5",
    "wide:min-h-[38px]",
    "wide:text-[13.5px]",
  ]) {
    assert.ok(tokens.includes(needle), `the nav row classes must carry the exact token ${needle}`);
  }
  assert.ok(!tokens.some((t) => t.startsWith("pointer-coarse:")), "no touch enlargement: the HTML's sizes on touch screens too (ruling R1)");
  const bar = literal("BRAND_NAV_BAR_CLASS").split(/\s+/);
  for (const needle of ["w-[3px]", "top-[9px]", "bottom-[9px]", "rounded-r-[3px]", "bg-brand-accent", "-left-2", "wide:-left-2.5", "group-data-[active=true]/item:opacity-100"]) {
    assert.ok(bar.includes(needle), `the active bar must carry the exact token ${needle}`);
  }
});

test("the group heading is the HTML's 11px uppercase nav-t2 label, shown in the wide form only", () => {
  const label = literal("BRAND_NAV_LABEL_CLASS");
  for (const needle of ["hidden", "wide:block", "uppercase", "text-[11px]", "font-semibold", "tracking-[0.06em]", "text-nav-t2", "pt-3.5", "pb-1.5", "px-2.5"]) {
    assert.ok(label.split(/\s+/).includes(needle), `BRAND_NAV_LABEL_CLASS must carry the exact token ${needle}`);
  }
});

test("the sidebar brand has no multiply blend (it misrenders on dark) and puts the logo on a white tile", () => {
  assert.ok(!BRAND.includes("mix-blend-multiply"), "mix-blend-multiply must be gone from SidebarBrand");
  assert.match(BRAND, /bg-white/, "the logo must sit on a white tile");
});

test("the nav's scroller carries the HTML's 8px scrollbar (values 1.4)", () => {
  const scroll = literal("BRAND_NAV_SCROLL_CLASS").split(/\s+/);
  for (const needle of ["overflow-y-auto", "[&::-webkit-scrollbar]:w-2", "[&::-webkit-scrollbar-thumb]:rounded-[8px]", "[&::-webkit-scrollbar-thumb]:bg-border"]) {
    assert.ok(scroll.includes(needle), `BRAND_NAV_SCROLL_CLASS must carry the exact token ${needle}`);
  }
  assert.match(SIDEBAR, /className=\{BRAND_NAV_SCROLL_CLASS\}/, "AppSidebar's groups sit in that scroller");
});

test("the active nav row keeps the HTML's weight 500: NAV_ACTIVE sets no font weight", () => {
  const active = CLASSES.match(/const NAV_ACTIVE =\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(active.length > 0, "landmark: NAV_ACTIVE was read");
  assert.ok(!/font-(medium|semibold|bold)/.test(active), "NAV_ACTIVE must not change the weight (the HTML's active row is 500)");
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

// Fix round 1: the device name in "{product} · {device}" / "{role} · {device}" is free text, so both second lines
// cut a long one with an ellipsis instead of running out of the nav.
test("the brand and user second lines truncate a long device name", () => {
  const brand = read("components/layout/SidebarBrand.tsx");
  const line = (src: string, ui: string): string[] =>
    src.match(new RegExp(`dataUi="${ui}" className="([^"]*)"`))?.[1].split(/\s+/) ?? [];
  for (const [src, ui] of [[brand, "nav-brand-line"], [ACCOUNT, "nav-user-line"]] as const) {
    const tokens = line(src, ui);
    assert.ok(tokens.length > 0, `landmark: the ${ui} class string was read`);
    assert.ok(tokens.includes("truncate"), `${ui} must truncate (overflow hidden + ellipsis)`);
  }
});

test("the Collapse button and the user card share the nav's press string; the Collapse class lives with the nav classes", () => {
  assert.match(CLASSES, /export const BRAND_NAV_PRESS_CLASS =/, "the press/transition string is exported");
  const collapse = CLASSES.match(/export const BRAND_NAV_COLLAPSE_CLASS =\s*"([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const token of ["hidden", "xl:flex", "h-[34px]", "rounded-[8px]", "px-2.5", "gap-2.5", "text-[12.5px]", "text-nav-t2", "wide:justify-start"]) {
    assert.ok(collapse.includes(token), `BRAND_NAV_COLLAPSE_CLASS must carry the HTML's ${token}`);
  }
  assert.match(CLASSES, /export const BRAND_NAV_COLLAPSE_CLASS =[^;]*BRAND_NAV_PRESS_CLASS/, "Collapse uses the press string");
  assert.match(SIDEBAR, /className=\{BRAND_NAV_COLLAPSE_CLASS\}/, "AppSidebar's Collapse button uses the shared class");
  assert.match(ACCOUNT, /BRAND_NAV_PRESS_CLASS/, "the user card uses the press string");
  assert.ok(!SIDEBAR.includes("active:scale-[0.97]") && !ACCOUNT.includes("active:scale-[0.97]"), "no inline copy of the press string");
});

test("the user card reads on dark: white name, the nav-t2 role line, and an avatar with the online dot", () => {
  assert.match(ACCOUNT, /data-ui="nav-user"[^>]*text-white/, "the user card's text is white");
  assert.match(ACCOUNT, /text-nav-t2/, "the role line must be text-nav-t2");
  assert.match(ACCOUNT, /<StaffAvatar[^>]*status="online"/, "the trigger must show a StaffAvatar with status online");
});
