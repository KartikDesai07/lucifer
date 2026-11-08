// Settings > Appearance in the new UI (docs/superpowers/plans/2026-11-08-settings-appearance-ui.md): the page shell, the
// five cards in order, the preview placement, the tile and choice looks, the buttons that must never submit, the heading
// levels and the WebView / brand bans. The card constants: lib/settings-card-layout.test.ts. The behaviour pins
// (Controllers, the one-commit picker, the copy): lib/appearance-settings-paths.test.ts and its -2 companion.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));

const PAGE = "app/(dashboard)/settings/appearance/page.tsx";
const FIELDS = "components/settings/AppearanceFields.tsx";
const THEME = "components/settings/AppearanceThemeGroup.tsx";
const ACCENT_GROUP = "components/settings/AppearanceAccentGroup.tsx";
const ACCENT_INPUT = "components/settings/AppearanceAccentInput.tsx";
const TEXT_LAYOUT = "components/settings/AppearanceTextLayoutGroup.tsx";
const PREVIEW = "components/settings/AppearancePreview.tsx";
const PARTS = [FIELDS, THEME, ACCENT_GROUP, ACCENT_INPUT, TEXT_LAYOUT, PREVIEW];
const OWNED = [PAGE, ...PARTS];

test("page file: Appearance keeps the wide shell and uses the card Save bar", () => {
  const p = read(PAGE);
  assert.ok(p.includes('<SettingsSectionPage slug="appearance" wide>'), "the wide shell: the preview column needs it");
  assert.ok(p.includes('saveBarLook="card"'), "the page opts into the card Save bar");
  assert.ok(p.includes("{({ control }) => <AppearanceFields control={control} />}"), "it renders the fields with the form control");
});

test("grid: the jump link, then Theme, Button colour, Text and layout, Banner picture and Preview, in one preview grid", () => {
  const s = read(FIELDS);
  const root = "<div className={SETTINGS_PREVIEW_GRID_CLASS}>";
  assert.equal(s.split(root).length - 1, 1, "the root is the shared preview grid, once");
  const order = [
    root,
    '<a\n        href="#appearance-preview"',
    "<AppearanceThemeGroup control={control} />",
    "<AppearanceAccentGroup control={control} presetId={presetId} />",
    "<AppearanceTextLayoutGroup control={control} />",
    'title="Banner picture"',
    'id="appearance-preview"',
  ];
  const at = order.map((needle) => {
    assert.equal(s.split(needle).length - 1, 1, `${needle} appears once`);
    return s.indexOf(needle);
  });
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i - 1] < at[i], `${order[i - 1]} comes before ${order[i]}`);
  const link = s.match(/<a\s+href="#appearance-preview"\s+className="([^"]*)"/)?.[1] ?? "";
  assert.equal(
    link,
    "inline-flex min-h-11 items-center gap-1.5 justify-self-start text-[13.5px] font-semibold text-primary xl:hidden",
    "the jump link: 44px, the primary colour, hidden once the preview sits beside the form",
  );
});

test("cards: the five titles and subs, each once; four form cards in column 1, the preview sticky in column 2", () => {
  const cards: Array<[string, string, string]> = [
    [THEME, 'title="Theme"', 'sub="The colours of your menu."'],
    [ACCENT_GROUP, 'title="Button colour"', 'sub="The colour of the Add buttons and other main buttons on your menu."'],
    [TEXT_LAYOUT, 'title="Text and layout"', 'sub="How the words, corners and spacing of your menu look."'],
    [FIELDS, 'title="Banner picture"', 'sub="A wide photo across the top of your menu. Leave it empty for no banner."'],
    [
      FIELDS,
      'title="Preview"',
      'sub="What diners see on their phone after they scan your table QR code. It changes as you edit."',
    ],
  ];
  for (const [rel, title, sub] of cards) {
    const s = read(rel);
    assert.equal(s.split(title).length - 1, 1, `${title} appears once`);
    assert.equal(s.split(sub).length - 1, 1, `${title}: its sub appears once`);
    assert.ok(s.indexOf(title) < s.indexOf(sub), `${title} comes before its sub`);
  }
  for (const rel of [THEME, ACCENT_GROUP, TEXT_LAYOUT]) {
    const s = read(rel);
    assert.equal(s.split("<SettingsCard").length - 1, 1, `${rel}: one card`);
    assert.equal(s.split("className={SETTINGS_MAIN_CARD_CLASS}").length - 1, 1, `${rel}: the card stays in column 1`);
  }
  const f = read(FIELDS);
  assert.equal(f.split("<SettingsCard").length - 1, 2, "AppearanceFields holds two cards: Banner picture and Preview");
  const banner = f.slice(f.indexOf('title="Banner picture"'), f.indexOf('id="appearance-preview"'));
  assert.ok(banner.includes("className={SETTINGS_MAIN_CARD_CLASS}"), "Banner picture stays in column 1");
  const preview = f.slice(f.indexOf('id="appearance-preview"'));
  assert.ok(preview.includes("className={APPEARANCE_PREVIEW_CLASS}"), "the preview is sticky in column 2 and scrolls inside itself");
  assert.ok(preview.includes('bodyClassName="rounded-b-[12px] bg-surface-2 p-3"'), "the preview body is the Taxes Bill preview body");
  assert.ok(preview.includes("<AppearancePreview control={control} />"), "the preview card holds the live preview");
});

test("tiles: theme and font tiles wear the shared tile look in a 2 / 3 column grid", () => {
  const theme = read(THEME);
  const text = read(TEXT_LAYOUT);
  assert.ok(theme.includes('const THEME_TILE_CLASS = "min-h-11 min-w-0 justify-center";'), "the theme tile's own size");
  assert.ok(
    theme.includes("className={cn(SETTINGS_TILE_CLASS, THEME_TILE_CLASS, selected ? SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS)}"),
    "theme tiles: the shared tile look",
  );
  assert.ok(theme.includes('className="h-6 w-6 rounded-full border border-border"'), "the swatch dots ring in the border token");
  assert.ok(theme.includes('<legend className="sr-only">Theme</legend>'), "the theme group keeps its hidden legend");
  assert.ok(text.includes('const FONT_TILE_CLASS = "min-h-14 min-w-0 justify-center gap-0.5 px-3 py-2";'), "the font tile's own size");
  assert.ok(
    text.includes("className={cn(SETTINGS_TILE_CLASS, FONT_TILE_CLASS, selected ? SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS)}"),
    "font tiles: the shared tile look",
  );
  assert.ok(text.includes('<legend className={cn("mb-1.5", SETTINGS_LABEL_CLASS)}>Font</legend>'), "the Font legend reads as a label");
  assert.ok(text.includes("<p id={hintId} className={SETTINGS_HINT_CLASS}>"), "the font hint in the card hint look");
  for (const s of [theme, text]) assert.ok(s.includes('"grid grid-cols-2 gap-2 sm:grid-cols-3"'), "2 columns, 3 from sm");
});

test("choices: Corners, Spacing, Logo on the menu and Diner's phone in are SettingsChoice groups with their hints", () => {
  const text = read(TEXT_LAYOUT);
  for (const legend of ["Corners", "Spacing", "Logo on the menu"]) {
    assert.match(text, new RegExp(`<SettingsChoice\\s+legend="${legend}"`), `${legend} is a SettingsChoice`);
  }
  assert.equal(text.split("<SettingsChoice").length - 1, 3, "three choices in Text and layout");
  assert.ok(
    text.includes('<AppLink href={settingsSectionPath("business")} className={SETTINGS_LINK_CLASS}>'),
    "the logo hint links Business details in the card link look",
  );
  const preview = read(PREVIEW);
  assert.match(preview, /<SettingsChoice\s+legend="Diner's phone in"\s+options=\{SCHEMES\}/, "the preview's Light / Dark choice");
  assert.ok(preview.includes('"mx-auto w-full max-w-sm overflow-clip rounded-2xl'), "the phone frame clips with overflow-clip");
});

test("buttons: every button on the page is type=button first, so a tap never submits (saves) the settings form", () => {
  let total = 0;
  for (const rel of PARTS) {
    const s = read(rel);
    const buttons = s.match(/<[bB]utton\b/g) ?? [];
    const typed = s.match(/<[bB]utton\s+type="button"/g) ?? [];
    assert.equal(typed.length, buttons.length, `${rel}: each <button> / <Button> starts with type="button"`);
    total += buttons.length;
  }
  assert.equal(total, 5, "landmark: 2 in Button colour (swatch, reset), 3 in the picker (trigger, swatch, apply)");
});

test("headings: the cards hold fieldsets, never a heading below the card's h2", () => {
  for (const rel of PARTS) {
    const s = read(rel);
    assert.ok(s.includes("export function"), `${rel}: read (landmark)`);
    assert.ok(!/<h[3-6]\b/.test(s), `${rel}: no h3-h6 (SettingsCard gives the h2)`);
  }
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, /NN colour opacity, old kit pieces", () => {
  for (const rel of OWNED) {
    const s = read(rel);
    assert.ok(s.length > 0 && s.includes("export"), `${rel}: read (landmark)`);
    assert.ok(!s.includes("color-mix"), `${rel}: no color-mix()`);
    assert.ok(!s.includes("light-dark("), `${rel}: no light-dark()`);
    assert.ok(!s.includes("backdrop-blur"), `${rel}: no backdrop-blur`);
    assert.ok(!s.includes("overflow-" + "hidden"), `${rel}: overflow-clip, never the hidden one`);
    assert.ok(!s.includes("brand-"), `${rel}: no brand-* class`);
    assert.ok(!/\bBRAND_/.test(s), `${rel}: no BRAND_* class constant`);
    assert.ok(!/<select\b/.test(s), `${rel}: the kit Select, never a native <select>`);
    const opacity = s.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/);
    assert.equal(opacity, null, `${rel}: no /NN opacity modifier on a colour (found ${opacity?.[0]})`);
    for (const old of ["SettingsGroup", "PrintSizeChoice", "SectionLink"]) {
      assert.ok(!s.includes(old), `${rel}: no ${old} (the old look)`);
    }
    assert.ok(!/\bHINT_CLASS\b/.test(s), `${rel}: SETTINGS_HINT_CLASS, not the old HINT_CLASS`);
  }
});

test("every touched file stays within 300 lines", () => {
  const touched = [
    ...OWNED,
    "components/settings/SettingsCard.tsx",
    "lib/settings-card-layout.ts",
    "lib/settings-appearance-layout.test.ts",
    "lib/appearance-settings-paths.test.ts",
    "lib/appearance-settings-paths-2.test.ts",
    "lib/settings-business-layout.test.ts",
    "lib/settings-card-layout.test.ts",
  ];
  for (const rel of touched) {
    const lines = readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length - 1;
    assert.ok(lines > 10, `${rel}: read (landmark)`);
    assert.ok(lines <= 299, `${rel} is ${lines} lines (wc -l <= 299)`);
  }
});
