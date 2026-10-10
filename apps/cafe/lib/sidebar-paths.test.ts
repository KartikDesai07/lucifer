// Source pins for the staff sidebar's 2026-09-26 redesign (components/layout/
// AppSidebar.tsx + its extracted pieces). The sidebar is chrome on EVERY
// staff screen, so the behaviours a restyle could silently drop are pinned:
// who sees which row, the "you are here" announcement, the phone sheet's
// labels, a waiting request staying visible in the folded rail, and the
// brand fonts/colours reaching the portaled phone sheet. Same readSrc +
// stripComments idiom as lib/kitchen-paths.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const APP_SIDEBAR = "apps/cafe/components/layout/AppSidebar.tsx";
const SETTINGS_GROUP = "apps/cafe/components/layout/SidebarSettingsGroup.tsx";
const REPORTS_GROUP = "apps/cafe/components/layout/SidebarReportsGroup.tsx";
const MENU_GROUP = "apps/cafe/components/layout/SidebarMenuGroup.tsx";
const TABLES_GROUP = "apps/cafe/components/layout/SidebarTablesGroup.tsx";
const SIDEBAR_BRAND = "apps/cafe/components/layout/SidebarBrand.tsx";
const REQUEST_BADGE = "apps/cafe/components/orders/RequestCountBadge.tsx";
const GLOBALS_CSS = "apps/cafe/app/globals.css";

/** The owner's tools. Everything else in the sidebar is for every signed-in role.
 *  Categories is admin-only too, but it is no longer a flat `{title,url}` nav
 *  entry (Menu redesign, 2026-09-30) — it moved into MENU_SECTIONS, read by
 *  the SidebarMenuGroup drop-down, so it never appears in this file's regex
 *  scan at all (see the Menu-group test below, which reads MENU_SECTIONS
 *  directly instead). */
const ADMIN_ONLY_URLS = ["/printers", "/reports", "/settings", "/staff", "/tables/setup"];
const NAV_ENTRY_COUNT = 17;

// 2026-10-10: Expenses (Manage, open to every role) became the 17th flat row.
// 2026-10-02: Floor (Service) and Printer setup (Admin, above Settings) became
// flat rows; the Tables row (Setup + QR codes) became admin-only.
test("PIN: the sidebar lists all 17 flat screens once each, and exactly Staff, Reports, Printer setup, Settings and the Tables (Setup / QR) row are admin-only", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const entries = [...src.matchAll(/\{\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)"[^}]*\}/g)].map((m) => ({
    title: m[1],
    url: m[2],
    adminOnly: /adminOnly:\s*true/.test(m[0]),
  }));
  // Mutation this catches: a regrouping that drops or duplicates a row — the
  // screen would then be unreachable from the nav, or listed twice.
  assert.equal(entries.length, NAV_ENTRY_COUNT, `expected ${NAV_ENTRY_COUNT} nav entries, found ${entries.map((e) => e.title).join(", ")}`);
  assert.equal(new Set(entries.map((e) => e.url)).size, NAV_ENTRY_COUNT, "every nav url must appear exactly once");
  // Mutation this catches: an admin tool losing adminOnly in a reshuffle —
  // every waiter would then see Staff / Reports / Settings in the sidebar.
  assert.deepEqual(
    entries.filter((e) => e.adminOnly).map((e) => e.url).sort(),
    ADMIN_ONLY_URLS,
    "exactly Staff, Reports, Printer setup, Settings and Tables carry adminOnly: true",
  );
  // And the filter that reads it is still applied to every section.
  assert.match(src, /items:\s*section\.items\.filter\(\(item\)\s*=>\s*!item\.adminOnly\s*\|\|\s*isAdmin\)/);
});

test("PIN: every sidebar link says which page is current — aria-current rides the same flag as the lit row", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  // Re-anchored 2026-10-02: an `exact` row (Floor) lights on its own path only.
  const rowFlag = src.match(/const active = item\.exact \? pathname === item\.url : isActivePath\(pathname, item\.url\);/);
  assert.ok(rowFlag, "the row's lit state must come from isActivePath (lib/nav-active.ts), or an exact match for an exact row");
  // Mutation this catches: dropping aria-current — a screen reader user
  // would hear every row the same, with no "current page" anywhere.
  assert.match(src, /isActive=\{active\}/, "the row must light from the same `active` flag");
  assert.match(src, /aria-current=\{active \? "page" : undefined\}/, "the row's link must carry aria-current from that flag");

  const group = stripComments(readSrc(SETTINGS_GROUP));
  assert.match(group, /isActive=\{active\}/, "each Settings section row lights from its own `active` flag");
  assert.match(group, /aria-current=\{active \? "page" : undefined\}/, "and announces it with aria-current");
  // Review finding 2026-09-28: on the /settings hub the list auto-opens but
  // no section row matches — the Settings row itself must light and announce
  // the page, or nothing in the sidebar says where you are.
  assert.match(group, /const onHub = pathname === url;/);
  assert.match(group, /isActive=\{onHub \|\| \(onSettings && !settingsOpen\)\}/, "the Settings row lights on the hub even with its list open");
  assert.match(group, /aria-current=\{onHub \? "page" : undefined\}/, "and announces the hub as the current page");
});

// Menu redesign (2026-09-30): Categories left the flat nav list and joined
// Items under one drop-down, read from lib/menu-sections.ts (MENU_SECTIONS)
// rather than a literal array inside the component — a shared source with the
// Categories/Items pages themselves.
test("PIN: the Menu group renders from MENU_SECTIONS (not a private literal) and announces its current sub-page with aria-current", () => {
  const group = stripComments(readSrc(MENU_GROUP));
  assert.match(
    group,
    /import\s*\{[^}]*MENU_SECTIONS[^}]*\}\s*from\s*"@\/lib\/menu-sections"/,
    "the Menu group must import MENU_SECTIONS from lib/menu-sections",
  );
  assert.match(group, /MENU_SECTIONS\.filter\(/, "the sub-menu list must be built from MENU_SECTIONS, filtered to what's visible");
  // Mutation this catches: dropping aria-current on a sub-row — a screen
  // reader user could not tell Items from Categories as "the current page".
  assert.match(group, /isActive=\{active\}/, "each Menu sub-row lights from its own `active` flag");
  assert.match(group, /aria-current=\{active \? "page" : undefined\}/, "and announces it with aria-current");

  const app = stripComments(readSrc(APP_SIDEBAR));
  assert.match(app, /<SidebarMenuGroup\b/, "AppSidebar must render the Menu group for the /products entry");
  assert.ok(!/\{ title: "Categories", url: "\/categories"/.test(app), "Categories must no longer be a flat AppSidebar nav entry");
});

// G15 (arbiter-confirmed): on the collapsed rail (or for staff, who see only
// one Menu sub-section) the group collapses to one plain Link to Items. Its
// LIT state must follow onMenu (isMenuPath), like SidebarReportsGroup's own
// collapsed branch — otherwise an admin on /categories with the rail folded
// sees the Menu icon go dark, as if no section under it were open.
test("PIN: the Menu group's collapsed/single-section Link lights on ANY menu page (onMenu), not only its own exact href", () => {
  const group = stripComments(readSrc(MENU_GROUP));
  const collapsedBranchStart = group.indexOf("if (collapsed || sections.length <= 1)");
  assert.ok(collapsedBranchStart >= 0, "landmark: the collapsed/single-section branch must still exist");
  const collapsedBranchEnd = group.indexOf("\n  }\n", collapsedBranchStart);
  const branch = group.slice(collapsedBranchStart, collapsedBranchEnd);

  assert.match(branch, /isActive=\{onMenu\}/, "the collapsed Link's visual lit state must be isActive={onMenu}, not the exact-match `active` flag");
  // aria-current stays exact -- this one Link only truly points at Items.
  assert.match(branch, /aria-current=\{exact \? "page" : undefined\}/, "aria-current must still announce only the exact Items match");
});

test("PIN: the phone sheet always shows row labels, whatever the desktop rail was last folded to", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  // Mutation this catches: `collapsed = state === "collapsed"` alone — a
  // tablet folded in landscape then turned to portrait would open a sheet of
  // bare icons (the folded state is remembered per browser).
  assert.match(src, /const collapsed = state === "collapsed" && !isMobile;/);
});

test("PIN: a waiting order request stays visible in the folded rail — a red dot on the icon, where the primitive hides the count", () => {
  const src = stripComments(readSrc(REQUEST_BADGE));
  const dot = src.match(/<span[^>]*className="([^"]*)"[^>]*\/>/);
  assert.ok(dot, "RequestCountBadge must render a dot <span> beside the count badge");
  const classes = dot![1].split(/\s+/);
  // Hidden in the full sidebar (the count shows there), shown in the rail.
  assert.ok(classes.includes("hidden"), "the dot is hidden by default");
  assert.ok(classes.includes("group-data-[collapsible=icon]:block"), "the dot shows only in the folded rail");
  assert.ok(classes.includes("bg-brand-danger"), "the dot is the same red as the count badge");
  // Mutation this catches: the primitive's peer rules re-colouring the count
  // on an active or hovered row (ink on red, unreadable).
  assert.match(src, /peer-data-\[active=true\]\/menu-button:text-white/);
  assert.match(src, /peer-hover\/menu-button:text-white/);
});

test("PIN: the brand fonts sit on a child of <Sidebar>, not its className — the phone sheet renders the children but drops the className", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const open = src.indexOf('<Sidebar collapsible="icon"');
  assert.ok(open >= 0, 'landmark: AppSidebar renders <Sidebar collapsible="icon"');
  const openEnd = src.indexOf(">", open);
  assert.ok(!src.slice(open, openEnd).includes("brandFontVariables"), "the font variables must not ride Sidebar's className");
  const next = src.slice(openEnd, openEnd + 200);
  // A stripped JSX comment leaves a bare {} behind; allow it.
  assert.match(
    next,
    /^>\s*(?:\{\}\s*)*<div className=\{`\$\{brandFontVariables\} /,
    "the first child of <Sidebar> carries the font variables",
  );
});

test("PIN: the sidebar's colours come from the brand palette on :root (the phone sheet is portaled, so a wrapper could not reach it)", () => {
  const css = readSrc(GLOBALS_CSS);
  const root = [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]).find((body) => body.includes("--sidebar:"));
  assert.ok(root, "a :root block must declare --sidebar");
  for (const [name, token] of [
    ["sidebar", "brand-sidebar"],
    ["sidebar-foreground", "brand-ink"],
    ["sidebar-accent", "brand-wash"],
    ["sidebar-accent-foreground", "brand-ink"],
    ["sidebar-border", "brand-rule"],
    ["sidebar-ring", "brand-accent"],
  ] as const) {
    assert.match(root!, new RegExp(`--${name}:\\s*var\\(--${token}\\);`), `--${name} must be var(--${token})`);
  }
});

// 2026-09-28 — slow-network fix: the busiest service screens are kept FULLY
// prefetched so a sidebar click renders from the router cache (see
// lib/warm-routes.ts). Pinned so a later edit can neither drop the warmth nor
// spread it to setup/admin screens (each warm route costs a background request
// per reuse window on every open device).
// Order (owner, 2026-09-29): Orders directly under New Order; Floor under both (2026-10-02).
const WARM_URLS = ["/", "/pos", "/orders", "/tables", "/requests", "/kitchen", "/now-serving", "/reservations"];
const NEXT_CONFIG = "apps/cafe/next.config.ts";

test("PIN: exactly the Dashboard and Service sections are warm — no setup or admin screen — and only the line-gated hook prefetches them (their Links never do)", () => {
  const src = stripComments(readSrc(APP_SIDEBAR));
  const heads = [...src.matchAll(/\{\s*(?:label:\s*"([^"]+)",\s*)?(warm:\s*true,\s*)?items:\s*\[/g)];
  assert.equal(heads.length, 4, "landmark: four nav sections (Dashboard, Service, Manage, Admin)");
  const warmUrls: string[] = [];
  heads.forEach((head, i) => {
    if (!head[2]) return;
    const body = src.slice(head.index!, i + 1 < heads.length ? heads[i + 1].index : undefined);
    for (const m of body.matchAll(/\{\s*title:\s*"[^"]+",\s*url:\s*"([^"]+)"[^}]*\}/g)) {
      assert.ok(!/adminOnly/.test(m[0]), `a warm section must never hold an admin-only row: ${m[0]}`);
      warmUrls.push(m[1]);
    }
  });
  assert.deepEqual(warmUrls, WARM_URLS, "the warm rows are the dashboard and the service screens, in sidebar order");

  // The warm rows are what the hook keeps prefetched (the FULL route — its
  // router.prefetch defaults to FULL); their own links do not prefetch at all.
  assert.match(src, /\.filter\(\(section\) => section\.warm\)\s*\.flatMap\(\(section\) => section\.items\.map\(\(item\) => item\.url\)\)/);
  assert.match(src, /useWarmRoutes\(warmHrefs\)/);
  // That their Links never prefetch is the next test (every sidebar Link).
});

/** Every `<Link …>` opening tag in `src`, brace-aware (a `>` inside `{…}` does not end it). */
function linkTags(src: string): string[] {
  const tags: string[] = [];
  for (const m of src.matchAll(/<Link\b/g)) {
    let depth = 0;
    let end = m.index!;
    for (; end < src.length; end++) {
      const ch = src[end];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(src.slice(m.index!, end + 1));
  }
  return tags;
}

test("PIN: no sidebar Link prefetches on its own — every one says prefetch={false}; the warm rows' only warmer is useWarmRoutes", () => {
  // 2026-09-29: a Link's default (or true) prefetch fires on sight and on
  // hover; on a line still waking up it can fail, and a failed prefetch turns
  // the next click into a full page load (vendor facts: lib/warm-routes.test.ts).
  for (const [file, expected] of [[APP_SIDEBAR, 1], [SETTINGS_GROUP, 2], [REPORTS_GROUP, 2], [MENU_GROUP, 2], [TABLES_GROUP, 2], [SIDEBAR_BRAND, 1]] as const) {
    const src = stripComments(readSrc(file));
    // Vision guards: Link is next/link under that one name, and the scan finds
    // every tag the file renders (an extractor that finds none proves nothing).
    assert.equal(src.match(/from "next\/link"/g)?.length, 1, `${file}: one next/link import`);
    assert.match(src, /import Link from "next\/link";/, `${file}: imported as Link`);
    const tags = linkTags(src);
    assert.equal(tags.length, expected, `${file}: expected ${expected} <Link> tags, found ${tags.length}`);
    for (const tag of tags) {
      assert.ok(tag.includes("href="), `landmark: a whole Link tag was read: ${tag}`);
      assert.equal(tag.match(/\bprefetch=/g)?.length, 1, `${file}: every Link sets prefetch exactly once: ${tag}`);
      assert.ok(tag.includes("prefetch={false}"), `${file}: a Link keeps a default or true prefetch: ${tag}`);
    }
  }
});

test("PIN: next.config lengthens only the FULL-prefetch reuse window — staleTimes carries `static` and never `dynamic`", () => {
  const src = stripComments(readSrc(NEXT_CONFIG));
  const block = src.match(/staleTimes:\s*\{([^}]*)\}/);
  assert.ok(block, "next.config.ts must set experimental.staleTimes");
  assert.match(block![1], /static:\s*PREFETCH_REUSE_SECONDS/);
  // Mutation this catches: adding `dynamic` — every page a user VISITED would
  // then be re-shown from cache, which for any server-data page means stale data.
  assert.ok(!/dynamic/.test(block![1]), "staleTimes must not set `dynamic`");
});

test("PIN: the brand header is a link to the Dashboard that closes the phone sheet, and the icon rail shows the real logo (the monogram only when it fails to load)", () => {
  const brand = stripComments(readSrc(SIDEBAR_BRAND));
  const tags = linkTags(brand);
  assert.equal(tags.length, 1, "landmark: SidebarBrand renders one <Link>");
  // Mutation this catches: the header going back to a plain <div> (the owner
  // asked for the cafe name to open the Dashboard), or pointing elsewhere.
  assert.ok(tags[0].includes(`href="/"`), "the brand link goes to the Dashboard");
  assert.ok(tags[0].includes("onClick={onNavigate}"), "a tap closes the phone sheet like a nav row");
  const app = stripComments(readSrc(APP_SIDEBAR));
  assert.match(app, /<SidebarBrand[^>]*onNavigate=\{closeMobile\}/, "AppSidebar hands the brand its closeMobile");
  // Mutation this catches: bringing back the wide-logo rule that swapped a
  // wordmark for the letter in the rail — only a load failure may.
  assert.match(brand, /\{failed \? \(/, "the monogram branch is keyed on the load failure alone");
  assert.ok(!/naturalWidth|WIDE_LOGO/.test(brand), "no logo-shape rule may hide the real logo in the rail");
  assert.match(brand, /collapsed && "w-8 max-w-8"/, "in the rail the logo is fitted to the 32px square");
  assert.match(brand, /object-contain/, "and scaled, never cropped");
});

// UI batch 1 C (2026-09-29) — "the Dashboard link sometimes does not respond".
// In the folded icon rail the primitive hides each section heading with
// opacity-0 and pulls it UP over the row above it (a negative top margin), and
// every SidebarGroup is `relative`, so the NEXT group paints — and hit-tests —
// on top of the previous one: the invisible "Service" heading sat over the
// lower half of the Dashboard icon and swallowed the click (measured in a real
// browser, c-dash harness). An invisible heading must never take a click.
const BRAND_CLASSES = "apps/cafe/components/brand/brand-classes.ts";

test("PIN: a section heading folded away in the icon rail is click-through — it can never swallow a tap on the row above it", () => {
  const src = stripComments(readSrc(BRAND_CLASSES));
  const m = src.match(/export const BRAND_NAV_LABEL_CLASS =\s*"([^"]*)";/);
  assert.ok(m, "landmark: BRAND_NAV_LABEL_CLASS is a plain class string");
  const classes = m![1].split(/\s+/);
  assert.ok(classes.includes("group-data-[collapsible=icon]:-mt-6"), "landmark: the heading still folds up in the rail");
  assert.ok(
    classes.includes("group-data-[collapsible=icon]:pointer-events-none"),
    "the folded (invisible) heading must not take pointer events",
  );
  // And every section heading in the sidebar uses that class.
  const app = stripComments(readSrc(APP_SIDEBAR));
  assert.equal(app.match(/<SidebarGroupLabel\b/g)?.length, 1, "landmark: one SidebarGroupLabel render site");
  assert.match(app, /<SidebarGroupLabel id=\{id\} className=\{BRAND_NAV_LABEL_CLASS\}>/);
});
