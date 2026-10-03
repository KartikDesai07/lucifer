import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Settings > Appearance DESIGN (settings pass slice 9, s71): Kitchen-ticket layout,
// four plain groups, radio tiles, 44px swatches and picker, and a plain English
// colour problem instead of the raw contrast pair. Source-read pins over
// comment-stripped source (the banned-copy scan reads RAW bytes).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const code = (rel: string): string => stripComments(readSrc(rel));

const SETTINGS = "apps/cafe/components/settings";
const FIELDS = `${SETTINGS}/AppearanceFields.tsx`;
const THEME = `${SETTINGS}/AppearanceThemeGroup.tsx`;
const ACCENT_GROUP = `${SETTINGS}/AppearanceAccentGroup.tsx`;
const ACCENT_INPUT = `${SETTINGS}/AppearanceAccentInput.tsx`;
const TEXT_LAYOUT = `${SETTINGS}/AppearanceTextLayoutGroup.tsx`;
const PREVIEW = `${SETTINGS}/AppearancePreview.tsx`;
const UTILS = `${SETTINGS}/appearance-fields-utils.ts`;
const CHOICE = `${SETTINGS}/PrintSizeChoice.tsx`;
const PAGE = "apps/cafe/app/(dashboard)/settings/appearance/page.tsx";
const SCHEMA = "packages/shared/src/schemas/settings-print.schema.ts";
const SHELL_PIN = "apps/cafe/lib/settings-shell-paths.test.ts";
const FORM_PIN = "apps/cafe/lib/print-form.test.ts";

const APPEARANCE_UI_FILES = [FIELDS, THEME, ACCENT_GROUP, ACCENT_INPUT, TEXT_LAYOUT, PREVIEW, PAGE];

const countOf = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

// Every Appearance*.tsx on disk, so a file added later is scanned too.
function appearanceFilesOnDisk(): string[] {
  return readdirSync(path.join(REPO_ROOT, SETTINGS))
    .filter((name) => /^Appearance.*\.tsx$/.test(name))
    .map((name) => `${SETTINGS}/${name}`);
}

// ── layout: grid, jump link, sticky preview ────────────────────────────────

test("PIN: the page is the Kitchen ticket layout - a settings column and a sticky preview column", () => {
  const src = code(FIELDS);
  assert.match(src, /export function AppearanceFields\(/, "landmark: the stripped source still has the component");
  assert.ok(
    src.includes(
      "space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8 lg:space-y-0",
    ),
    "the grid classes",
  );
  assert.ok(
    src.includes(
      "border-t border-brand-rule pt-6 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:border-t-0 lg:pt-0",
    ),
    "the preview column is sticky and scrolls inside itself",
  );
  assert.match(code(PAGE), /<SettingsSectionPage slug="appearance" wide>/, "the page keeps the wide shell");
});

test("PIN: the preview group has id=appearance-preview and a lg:hidden jump link points at it", () => {
  const src = code(FIELDS);
  assert.match(src, /<SettingsGroup\s+stacked\s+id="appearance-preview"\s+title="Preview"/, "the preview group carries the id");
  assert.match(src, /<AppearancePreview control=\{control\} \/>/, "the preview sits inside the group");
  const link = src.match(/<a\s+href="#appearance-preview"\s+className="([^"]*)"/);
  assert.ok(link, "a jump link to the preview");
  assert.match(link[1], /(^|\s)lg:hidden(\s|$)/, "hidden on a computer");
  assert.match(link[1], /(^|\s)min-h-11(\s|$)/, "at least 44px tall");
  assert.match(link[1], /(^|\s)text-brand-primary(\s|$)/, "the link colour");
  assert.match(src, /See the preview/, "the link says what it does");
});

// ── groups ──────────────────────────────────────────────────────────────────

test("PIN: the four settings groups and the preview group have these plain titles", () => {
  assert.match(code(THEME), /title="Theme"/);
  assert.match(code(ACCENT_GROUP), /title="Button colour"/);
  assert.match(code(TEXT_LAYOUT), /title="Text and layout"/);
  assert.match(code(FIELDS), /title="Banner picture"/);
  assert.match(code(FIELDS), /title="Preview"/);
});

test("PIN: every SettingsGroup on the Appearance page is stacked", () => {
  let groups = 0;
  for (const rel of APPEARANCE_UI_FILES) {
    const src = code(rel);
    const opened = countOf(src, /<SettingsGroup\b/g);
    const stacked = countOf(src, /<SettingsGroup\s+stacked\b/g);
    assert.equal(stacked, opened, `${rel}: every <SettingsGroup must be stacked`);
    groups += opened;
  }
  assert.equal(groups, 5, "landmark: Theme, Button colour, Text and layout, Banner picture, Preview");
});

test("PIN: the banner picture is the wide ImageUpload on appearance.heroImage, alt Menu banner", () => {
  const src = code(FIELDS);
  assert.match(src, /name="appearance\.heroImage"/);
  assert.match(src, /slot="heroImage"/);
  assert.match(src, /aspect="wide"/);
  assert.match(src, /alt="Menu banner"/);
});

test("PIN: every Appearance control is a Controller on appearance.* - never register() or setValue()", () => {
  const names = new Set<string>();
  for (const rel of APPEARANCE_UI_FILES) {
    const src = code(rel);
    assert.ok(!/\bregister\(/.test(src), `${rel}: no register(`);
    assert.ok(!/\bsetValue\(/.test(src), `${rel}: no setValue(`);
    for (const m of src.matchAll(/name="(appearance\.[A-Za-z]+)"/g)) names.add(m[1]);
  }
  const seven = ["accentOverride", "cornerRadius", "density", "fontPairKey", "heroImage", "logoPlacement", "presetId"];
  assert.deepEqual([...names].sort(), seven.map((k) => "appearance." + k), "all seven fields stay wired");
  assert.match(code(FIELDS), /useWatch\(\{ control, name: "appearance\.presetId" \}\)/, "the presetId watch stays");
});

// ── theme tiles ─────────────────────────────────────────────────────────────

test("PIN: the theme is radio tiles keyed off PRESET_IDS, with three 24px swatch dots", () => {
  const src = code(THEME);
  assert.match(src, /PRESET_IDS\.map\(/, "one tile per preset, from the shared list");
  assert.match(src, /type="radio"/, "native radios");
  assert.match(src, /name=\{name\}/, "one shared name per group");
  assert.match(src, /const name = useId\(\)/, "the name comes from useId");
  assert.match(src, /SWATCH_KEYS = \["background", "card", "primary"\] as const/, "fixed dot order");
  assert.match(src, /h-6 w-6 rounded-full/, "dots are 24px");
  assert.match(src, /min-h-11/, "tiles are at least 44px");
  assert.ok(src.includes("border-brand-primary bg-brand-primary-soft"), "selected style");
  assert.ok(src.includes("border-brand-rule bg-brand-slip hover:bg-brand-wash"), "unselected style");
  assert.ok(!/aria-pressed/.test(src), "radio semantics, not toggle buttons");
});

// ── button colour ───────────────────────────────────────────────────────────

test("PIN: the colour swatches and the colour picker are 44px, and a swatch is named by its number never its hex", () => {
  const group = code(ACCENT_GROUP);
  const input = code(ACCENT_INPUT);
  assert.match(group, /suggestions\.map\(\(hex, index\)/, "landmark: swatches come from the suggestions");
  assert.match(group, /"h-11 w-11 shrink-0 rounded-full border-2/, "swatches are 44px round with the selected ring");
  assert.match(group, /aria-pressed=\{accentValue === hex\}/, "a swatch still says if it is picked");
  assert.match(group, /aria-label=\{`Suggested colour \$\{index \+ 1\}`\}/, "named by its number");
  assert.ok(!/aria-label=\{`[^`]*\$\{hex\}/.test(group), "no hex in the accessible name");
  assert.match(input, /type="color"[\s\S]*?className="h-11 w-11 /, "the picker is 44px");
});

test("PIN: the picker has a visible label and the reset button is an outline button that is 44px on a phone", () => {
  const input = code(ACCENT_INPUT);
  const group = code(ACCENT_GROUP);
  assert.match(input, /const inputId = useId\(\)/);
  assert.match(input, /id=\{inputId\}/, "the input has an id");
  assert.match(input, /<label htmlFor=\{inputId\}[^>]*>\s*Pick your own colour\s*<\/label>/, "a visible label for it");
  assert.ok(!/aria-label=/.test(input), "named by the visible label, not an aria-label");
  assert.match(group, /variant="outline"/);
  assert.match(group, /className="h-11 md:h-10"/);
  assert.ok(group.includes("Use the theme&apos;s colour"), "the reset button text");
  assert.match(group, /disabled=\{accentValue === ""\}/, "disabled while there is no override");
});

test("PIN: the colour problem is shown in plain English via accentProblemText(feedback.reason), never the raw failing pair", () => {
  const src = code(ACCENT_INPUT);
  assert.match(src, /const feedback = untouchedDefault \?/, "landmark: the feedback guard is still here");
  assert.match(src, /accentProblemText\(feedback\.reason\)/, "the message comes from the plain-English map");
  assert.match(src, /role="status"/, "announced politely");
  assert.match(src, /BRAND_FIELD_ERROR_CLASS/, "the shared error style");
  assert.match(src, /order-last w-full/, "on its own full-width line under the row");
  assert.ok(!/\.failing\b/.test(src), "the raw failing string is never read here");
});

test("PIN: the shared schema's accent issue uses accentProblemText( - the Save toast is plain English too", () => {
  const src = code(SCHEMA);
  assert.match(src, /checkAccent\(data\.accentOverride, data\.presetId\)/, "landmark: the accent gate is still here");
  assert.match(src, /message: accentProblemText\(result\.reason\)/, "the issue message is the plain text");
  assert.ok(!/message: result\.failing/.test(src), "the raw failing string is not the message");
});

// ── text and layout ─────────────────────────────────────────────────────────

test("PIN: the font choice is radio tiles keyed off FONT_PAIR_KEYS, each name in its own display font", () => {
  const src = code(TEXT_LAYOUT);
  assert.match(src, /FONT_PAIR_KEYS\.map\(/, "one tile per pair, from the shared list");
  assert.match(src, /fontFamily: FONT_PAIR_FAMILIES\[key\]\.display/, "the name is written in the pair's display font");
  assert.match(src, /type="radio"/);
  assert.match(src, /<legend[^>]*>Font<\/legend>/, "a visible Font legend");
  assert.match(src, /min-h-14/, "tiles are at least 56px");
  assert.ok(src.includes("Each name is written in its font. The preview shows it on your menu."), "the hint");
  assert.ok(!/@\/components\/ui\/select/.test(src), "no stock select");
  assert.ok(!/<Select/.test(src), "no <Select... drop-down");
  assert.match(code(UTILS), /FONT_PAIR_LABELS: Record<FontPairKey, \{ name: string; fonts: string \}>/, "name + font names");
});

test("PIN: corners, spacing and logo are PrintSizeChoice tiles with their hints", () => {
  const src = code(TEXT_LAYOUT);
  assert.match(src, /name="appearance\.cornerRadius"[\s\S]*?<PrintSizeChoice\s+legend="Corners"\s+options=\{CORNER_RADII\}/);
  assert.match(src, /name="appearance\.density"[\s\S]*?<PrintSizeChoice\s+legend="Spacing"\s+options=\{DENSITIES\}/);
  assert.match(src, /name="appearance\.logoPlacement"[\s\S]*?<PrintSizeChoice\s+legend="Logo on the menu"\s+options=\{LOGO_PLACEMENTS\}/);
  assert.match(src, /hint="How round the buttons and dish cards are\."/);
  assert.match(src, /hint="Compact fits more dishes on one screen\. Roomy leaves more space around each dish\."/);
  assert.match(src, /<SectionLink slug="business">Business details<\/SectionLink>/, "the logo hint links to Business details");
  assert.equal(countOf(src, /\?\? DEFAULT_APPEARANCE\.(fontPairKey|cornerRadius|density|logoPlacement)/g), 4, "each keeps its default");
});

test("PIN: the display labels are plain English", () => {
  const src = code(UTILS);
  assert.match(src, /center: "Centre"/);
  assert.match(src, /hidden: "No logo"/);
  assert.match(src, /compact: "Compact"/);
  assert.match(src, /cosy: "Cosy"/);
  assert.match(src, /roomy: "Roomy"/);
});

// ── preview ─────────────────────────────────────────────────────────────────

test("PIN: the preview's Light/Dark switch is a PrintSizeChoice with the dark-mode hint, over a full-width phone frame", () => {
  const src = code(PREVIEW);
  assert.match(src, /export function AppearancePreview\(/, "landmark");
  assert.match(src, /<PrintSizeChoice\s+legend="Diner's phone in"\s+options=\{SCHEMES\}/, "a PrintSizeChoice, not tab buttons");
  assert.ok(src.includes("Light mode") && src.includes("Dark mode"), "plain labels");
  assert.ok(src.includes("Diners see the dark version when their phone is in dark mode, unless they choose light themselves."), "the hint");
  assert.ok(src.includes("mx-auto w-full max-w-sm"), "the frame fills the column up to phone width");
});

// ── PrintSizeChoice hint ────────────────────────────────────────────────────

test("PIN: PrintSizeChoice takes an optional hint that sits in the fieldset and describes it", () => {
  const src = code(CHOICE);
  assert.match(src, /export function PrintSizeChoice</, "landmark");
  assert.match(src, /hint\?: React\.ReactNode/, "optional");
  assert.match(src, /aria-describedby=\{hint \? hintId : undefined\}/, "the group is described by it");
  assert.match(src, /\{hint && <p id=\{hintId\} className=\{HINT_CLASS\}>\{hint\}<\/p>\}/, "rendered under the tiles");
});

// ── retired idioms and banned copy ──────────────────────────────────────────

test("PIN: no Appearance file uses size=sm, role=tab, or the stock Card", () => {
  const files = appearanceFilesOnDisk();
  for (const rel of APPEARANCE_UI_FILES.filter((f) => f.startsWith(SETTINGS))) {
    assert.ok(files.includes(rel), `landmark: ${rel} exists`);
  }
  assert.ok(files.length >= 6, "the scan found the Appearance files");
  const sizeSm = "size" + '="sm"';
  const roleTab = "role" + '="tab';
  const cardTag = "<" + "Card";
  const cardImport = "@/components/ui/" + "card";
  for (const rel of [...files, PAGE]) {
    const src = code(rel);
    assert.ok(src.length > 100, `${rel}: vision guard - the scanned source is non-empty`);
    assert.ok(!src.includes(sizeSm), `${rel}: no ${sizeSm}`);
    assert.ok(!src.includes(roleTab), `${rel}: no ${roleTab}`);
    assert.ok(!src.includes(cardTag), `${rel}: no ${cardTag}`);
    assert.ok(!src.includes(cardImport), `${rel}: no ${cardImport}`);
  }
});

test("PIN: the retired copy is gone from every Appearance UI file (raw bytes, comments included)", () => {
  const banned = [
    "Hero" + " image",
    "Accent" + " color",
    "Use preset" + " accent",
    "Corner" + " radius",
    "Dens" + "ity",
    "Live" + " preview",
  ];
  let scannedBytes = 0;
  for (const rel of [...appearanceFilesOnDisk(), PAGE]) {
    const raw = readSrc(rel);
    scannedBytes += raw.length;
    for (const needle of banned) {
      assert.ok(!raw.includes(needle), `${rel} must not contain "${needle}"`);
    }
  }
  assert.ok(scannedBytes > 5000, "vision guard: the scan read real source");
  assert.ok(readSrc(FIELDS).includes("Banner picture"), "landmark: the new copy is in the scanned source");
});

test("PIN: AppearanceSegmentedField.tsx is deleted and nothing imports it", () => {
  assert.ok(existsSync(path.join(REPO_ROOT, FIELDS)), "landmark: the sibling file exists, so the directory is the right one");
  assert.ok(!existsSync(path.join(REPO_ROOT, SETTINGS, "AppearanceSegmentedField.tsx")), "the file is gone");
  for (const rel of appearanceFilesOnDisk()) {
    assert.ok(!readSrc(rel).includes("AppearanceSegmentedField"), `${rel} must not mention it`);
  }
});

test("PIN: the role=tab pins no longer exempt any Appearance file", () => {
  const exemption = "KNOWN_SEGMENTED_CONTROL_FILES = new Set" + "<string>();";
  for (const rel of [SHELL_PIN, FORM_PIN]) {
    const src = readSrc(rel);
    assert.ok(src.includes(exemption), `${rel}: the exemption set is empty`);
    assert.ok(!src.includes("Appearance" + "Preview.tsx`"), `${rel}: AppearancePreview is not exempted`);
  }
});

test("PIN: every Appearance file stays under 300 lines", () => {
  for (const rel of [...appearanceFilesOnDisk(), PAGE, CHOICE, UTILS]) {
    const lines = readSrc(rel).split("\n").length;
    assert.ok(lines > 10, `${rel}: vision guard`);
    assert.ok(lines <= 300, `${rel}: ${lines} lines`);
  }
});
