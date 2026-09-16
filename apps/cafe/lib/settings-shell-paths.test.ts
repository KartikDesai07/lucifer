import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";

// CB-UI1 S6 — source-read pins for the new Settings shell (7 section routes +
// Printer setup under a /settings hub, sidebar Settings expanding in place,
// per-page Save). Same technique as branding-paths.test.ts / order-request-
// paths.test.ts: readFileSync over the REAL source, comments stripped so a
// comment merely DESCRIBING a rule can neither satisfy nor trip the pin
// meant to enforce it.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const absOf = (rel: string): string => path.join(REPO_ROOT, rel);

const SKIP_DIRS = new Set(["node_modules", ".next"]);

// Recursively collects every .ts/.tsx file under dirAbs into out — same
// walk idiom as telegram-paths.test.ts / order-request-paths.test.ts.
function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(abs);
    }
  }
}

const CAFE = "apps/cafe";
const SETTINGS_APP_DIR = `${CAFE}/app/(dashboard)/settings`;
const SETTINGS_HUB_PAGE = `${SETTINGS_APP_DIR}/page.tsx`;
const SETTINGS_LAYOUT = `${SETTINGS_APP_DIR}/layout.tsx`;
const USE_SETTINGS_SECTION_FORM = `${CAFE}/hooks/use-settings-section-form.ts`;
const SETTINGS_SAVE_BAR = `${CAFE}/components/settings/SettingsSaveBar.tsx`;
const APP_SIDEBAR = `${CAFE}/components/layout/AppSidebar.tsx`;
const SIDEBAR_SETTINGS_GROUP = `${CAFE}/components/layout/SidebarSettingsGroup.tsx`;
const DASHBOARD_LAYOUT = `${CAFE}/app/(dashboard)/layout.tsx`;
const HEADER = `${CAFE}/components/layout/Header.tsx`;
const RETIRED_SETTINGS_FORM = `${CAFE}/components/settings/SettingsForm.tsx`;
const RETIRED_GENERAL_SETTINGS_FIELDS = `${CAFE}/components/settings/GeneralSettingsFields.tsx`;
const RETIRED_PRINT_SETTINGS_FIELDS = `${CAFE}/components/settings/PrintSettingsFields.tsx`;

const FORM_SECTION_SLUGS = SETTINGS_SECTIONS.filter((s) => s.slug !== "printing").map((s) => s.slug);

// ── 1. every slug has a page.tsx on disk, and the hub exists ───────────────

test("PIN: every SETTINGS_SECTIONS slug has app/(dashboard)/settings/<slug>/page.tsx on disk, and settings/page.tsx (the hub) exists", () => {
  for (const section of SETTINGS_SECTIONS) {
    const pagePath = absOf(`${SETTINGS_APP_DIR}/${section.slug}/page.tsx`);
    assert.ok(existsSync(pagePath), `${section.slug} must have a page.tsx at ${pagePath}`);
  }
  assert.ok(existsSync(absOf(SETTINGS_HUB_PAGE)), "settings/page.tsx (the hub) must exist");
});

// ── 2. settings/layout.tsx wraps every route in AdminGuard ─────────────────

test("PIN: app/(dashboard)/settings/layout.tsx imports AdminGuard and wraps {children} in it — the only guard the new section pages rely on", () => {
  const src = stripComments(readSrc(SETTINGS_LAYOUT));
  assert.match(
    src,
    /import\s*\{\s*AdminGuard\s*\}\s*from\s*"@\/components\/shared\/AdminGuard"/,
    "settings/layout.tsx must import AdminGuard from @/components/shared/AdminGuard",
  );
  assert.match(
    src,
    /<AdminGuard>\{children\}<\/AdminGuard>/,
    "settings/layout.tsx must render <AdminGuard>{children}</AdminGuard> — a narrower wrap (e.g. wrapping only part of the tree, or a differently-named prop) would leave some settings route unguarded",
  );
});

// ── 3. hub reachability — every section reachable, Printer setup reachable ─

test("PIN: settings/page.tsx (the hub) imports SETTINGS_SECTIONS + settingsSectionPath and contains a literal href=\"/settings/printing\" — every section (incl. Printer setup) must be reachable from the hub, not just compiled", () => {
  const src = stripComments(readSrc(SETTINGS_HUB_PAGE));

  assert.match(
    src,
    /import\s*\{[^}]*\bSETTINGS_SECTIONS\b[^}]*\}\s*from\s*"@\/lib\/settings-sections"/,
    "settings/page.tsx must import SETTINGS_SECTIONS from @/lib/settings-sections",
  );
  assert.match(
    src,
    /\bsettingsSectionPath\b/,
    "settings/page.tsx must use settingsSectionPath to build each section card's link",
  );
  assert.ok(
    src.includes('href="/settings/printing"'),
    'settings/page.tsx must render a literal href="/settings/printing" card for Printer setup — printer-setup-paths.test.ts pins this exact literal',
  );

  // Positive landmark for the reachability claim itself: the hub must
  // actually render each section's own link target, not just import the
  // constant and never use it.
  assert.match(src, /<ChevronRight/, "positive landmark: the hub must render a <ChevronRight indicator on its section cards");
});

// ── 4. no retired tab-router role markup survives (vision-guarded) ─────────

test('PIN: no file under components/settings/ or app/(dashboard)/settings/ contains role="tablist"/role="tab" belonging to the retired SettingsForm tab router — the tab-router markup that print-form.test.ts B3 used to pin is gone by construction (one form per route)', () => {
  // Needle built by concatenation (testing.md grep-gate rule) so this file's
  // own assertion text can never satisfy itself.
  const roleAttr = "role" + "=";
  const tablistValue = '"' + "tablist" + '"';
  const tabValue = '"' + "tab" + '"';

  // KNOWN, PRE-EXISTING, UNRELATED exception: AppearancePreview.tsx and
  // AppearanceSegmentedField.tsx (both under components/settings/, landed in
  // CR2.4, well before CB-UI1) use role="tablist"/role="tab" as an ARIA
  // segmented-control idiom for the Appearance colour-scheme preview toggle —
  // a completely different widget from the retired 4-tab Settings-form
  // navigation this pin polices. Reported to the main thread as an ambiguity
  // (S6 return); excluded here by exact relative path so the exclusion is
  // narrow and visible, not a blanket carve-out.
  const KNOWN_SEGMENTED_CONTROL_FILES = new Set([
    `${CAFE}/components/settings/AppearancePreview.tsx`,
    `${CAFE}/components/settings/AppearanceSegmentedField.tsx`,
  ]);

  const files: string[] = [];
  walk(absOf(`${CAFE}/components/settings`), files);
  walk(absOf(SETTINGS_APP_DIR), files);
  assert.ok(files.length > 5, "the walk must find a substantial number of files under components/settings/ + app/(dashboard)/settings/, or it found the wrong directory");

  const offenders = files
    .map((abs) => ({ abs, rel: path.relative(REPO_ROOT, abs).split(path.sep).join("/") }))
    .filter(({ rel }) => !KNOWN_SEGMENTED_CONTROL_FILES.has(rel))
    .filter(({ abs }) => {
      const src = stripComments(readFileSync(abs, "utf8"));
      const idx = src.indexOf(roleAttr);
      if (idx < 0) return false;
      // Only trip on role="tablist" / role="tab" specifically — role="..."
      // for an unrelated ARIA role must not false-positive this pin.
      return new RegExp(`${roleAttr}${tablistValue}|${roleAttr}${tabValue}`).test(src);
    })
    .map(({ rel }) => rel);

  assert.deepEqual(
    offenders,
    [],
    `no file under components/settings/ or app/(dashboard)/settings/ (outside the known segmented-control exception) may declare role="tablist"/role="tab" — found: ${JSON.stringify(offenders)}`,
  );

  // Positive landmark so the negative assertion above isn't vacuously true
  // (an accidentally-blinded stripComments/walk could pass with an empty
  // file list just as easily as a genuinely clean one).
  const hubSrc = readSrc(SETTINGS_HUB_PAGE);
  assert.match(hubSrc, /SETTINGS_SECTIONS/, "positive landmark: settings/page.tsx must reference SETTINGS_SECTIONS — proves the scan actually read real, non-empty source");
});

// ── 5. the retired single-form files are gone; their replacement exists ────

test("PIN: SettingsForm.tsx, GeneralSettingsFields.tsx and PrintSettingsFields.tsx no longer exist — the single 4-tab form is fully retired, not left as dead code beside the new shell", () => {
  assert.ok(!existsSync(absOf(RETIRED_SETTINGS_FORM)), "components/settings/SettingsForm.tsx must not exist");
  assert.ok(!existsSync(absOf(RETIRED_GENERAL_SETTINGS_FIELDS)), "components/settings/GeneralSettingsFields.tsx must not exist");
  assert.ok(!existsSync(absOf(RETIRED_PRINT_SETTINGS_FIELDS)), "components/settings/PrintSettingsFields.tsx must not exist");

  // Positive landmark: the replacement hook must exist, or "the old files are
  // gone" would trivially pass on a half-finished migration with no new form
  // model to replace them.
  assert.ok(existsSync(absOf(USE_SETTINGS_SECTION_FORM)), "positive landmark: hooks/use-settings-section-form.ts must exist as the retired files' replacement");
});

// ── 6. the section-form hook wires unsaved-guard, section split, form reset ─

test("PIN: use-settings-section-form.ts calls useUnsavedGuard(, pickSectionValues(, destructures reset off useForm and calls reset( to re-baseline after a save, and imports settingsSchema + zodResolver", () => {
  const src = stripComments(readSrc(USE_SETTINGS_SECTION_FORM));

  assert.match(src, /useUnsavedGuard\(/, "the hook must call useUnsavedGuard( to arm the beforeunload guard while the form is dirty");
  assert.match(src, /pickSectionValues\(/, "the hook must call pickSectionValues( to submit only this section's own keys through the one PUT /api/settings");
  // The hook destructures `reset` straight off `form` (`const { ..., reset,
  // ... } = form;`), so the call site reads `reset(` — never a `form.reset(`
  // qualified call. Both the destructure and a call are pinned so a stray
  // `reset` import from elsewhere (or a destructure with no call) can't pass.
  assert.match(src, /const\s*\{[^}]*\breset\b[^}]*\}\s*=\s*form;/, "the hook must destructure reset off the useForm() instance");
  assert.match(src, /\breset\(/, "the hook must call reset( to re-baseline the dirty flag after a successful save (arbitration R1: plain reset(values), no keepValues)");
  assert.match(src, /\bsettingsSchema\b/, "the hook must import/use settingsSchema — every section validates against the FULL schema, not a narrowed one");
  assert.match(src, /\bzodResolver\b/, "the hook must import/use zodResolver to wire settingsSchema into react-hook-form");
});

// ── 7. SettingsSaveBar: dirty-gated, both buttons disabled while saving ────

test('PIN: SettingsSaveBar.tsx early-returns on !isDirty, both its buttons carry disabled={isSaving}, and its submit button is type="submit"', () => {
  const src = stripComments(readSrc(SETTINGS_SAVE_BAR));

  assert.match(
    src,
    /if\s*\(\s*!isDirty\s*\)\s*return\s*null;/,
    "SettingsSaveBar must early-return null when !isDirty — a bar shown on an untouched form would prompt Save with nothing to save",
  );

  const disabledMatches = src.match(/disabled=\{isSaving\}/g) ?? [];
  assert.ok(
    disabledMatches.length >= 2,
    `both the Discard and Save buttons must carry disabled={isSaving} — found ${disabledMatches.length} occurrence(s)`,
  );

  assert.match(
    src,
    /<Button\s+type="submit"\s+disabled=\{isSaving\}>/,
    'the Save button must be type="submit" (so the form\'s own onSubmit/handleSubmit fires) with disabled={isSaving}',
  );
});

// ── 8. AppSidebar / SidebarSettingsGroup: collapsible sub-menu wiring ──────

test("PIN: AppSidebar.tsx (+ the extracted SidebarSettingsGroup.tsx) import SidebarMenuSub + SETTINGS_SECTIONS, contain setOpenMobile(false), and the Collapsible's chevron carries group-data-[state=open]/collapsible:rotate-90 — the sidebar Settings entry expands in place instead of navigating away", () => {
  const appSidebarSrc = stripComments(readSrc(APP_SIDEBAR));
  const groupFileExists = existsSync(absOf(SIDEBAR_SETTINGS_GROUP));
  const groupSrc = groupFileExists ? stripComments(readSrc(SIDEBAR_SETTINGS_GROUP)) : "";
  // The Settings sub-menu wiring may live directly in AppSidebar.tsx, or (if
  // AppSidebar would exceed the file's line ceiling) be extracted into its
  // own SidebarSettingsGroup.tsx — the design contract's file list names
  // AppSidebar.tsx, but S5's own text explicitly allows this extraction.
  // Every assertion below is checked against the UNION of both files' source
  // so either layout satisfies the pin.
  const combined = appSidebarSrc + "\n" + groupSrc;

  assert.match(
    combined,
    /\bSidebarMenuSub\b/,
    "SidebarMenuSub must be imported somewhere in the sidebar Settings wiring (AppSidebar.tsx or its extracted group file)",
  );
  assert.match(
    combined,
    /\bSETTINGS_SECTIONS\b/,
    "SETTINGS_SECTIONS must be imported and iterated to render one sub-item per section",
  );

  // setOpenMobile(false) specifically — not merely "setOpenMobile" — since a
  // call with any other argument would not actually close the phone Sheet.
  assert.match(
    combined,
    /setOpenMobile\(false\)/,
    "setOpenMobile(false) must appear — shadcn's sidebar primitive does not auto-close the phone Sheet on nav (research brief, PR #8402)",
  );

  assert.match(
    combined,
    /group-data-\[state=open\]\/collapsible:rotate-90/,
    "the trigger's chevron must rotate via group-data-[state=open]/collapsible:rotate-90 when the Collapsible is open",
  );

  // The opening effect's dependency list must be [onSettings] — a plain
  // [pathname] would re-fire (and re-force the menu open) on every in-
  // settings navigation, defeating a manual collapse (arbitration R3).
  assert.match(
    appSidebarSrc,
    /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(onSettings\)\s*setSettingsOpen\(true\);\s*\},\s*\[onSettings\]\)/,
    "the Collapsible's opening effect must read `if (onSettings) setSettingsOpen(true)` with a dependency array of exactly [onSettings] — never [pathname], which would re-open the menu on every in-settings navigation",
  );
});

// ── 9. every section page renders SettingsSectionPage + SettingsSectionForm ─

test("PIN: every SETTINGS_SECTIONS entry except printing renders <SettingsSectionPage and <SettingsSectionForm on its own page.tsx — the shared shell is actually used, not merely available", () => {
  for (const slug of FORM_SECTION_SLUGS) {
    const src = stripComments(readSrc(`${SETTINGS_APP_DIR}/${slug}/page.tsx`));
    assert.match(src, /<SettingsSectionPage/, `${slug}/page.tsx must render <SettingsSectionPage`);
    assert.match(src, /<SettingsSectionForm/, `${slug}/page.tsx must render <SettingsSectionForm`);
  }
});

// ── 10. the height-chain shell stays byte-identical (parity, not replacement) ─

test('PIN: (dashboard)/layout.tsx\'s <main className="flex-1 p-4 md:p-6"> and Header.tsx\'s h-14 are UNTOUCHED by the Settings redesign — parity with pos-layout-paths.test.ts\'s own pin, not a new claim replacing it', () => {
  const dashboardSrc = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(
    dashboardSrc,
    /<main className="flex-1 p-4 md:p-6">/,
    "(dashboard)/layout.tsx's <main> must keep its unchanged flex-1 p-4 md:p-6 padding",
  );

  const headerSrc = stripComments(readSrc(HEADER));
  assert.match(headerSrc, /\bh-14\b/, "Header.tsx must keep its h-14 height class");
});
