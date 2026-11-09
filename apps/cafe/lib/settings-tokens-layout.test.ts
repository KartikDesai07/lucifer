// Settings > Tokens & numbering in the new UI (docs/superpowers/plans/2026-11-09-settings-tokens-ui.md): the page shell
// and its one stack beside the sticky slip preview, the three token cards, each hint / warning wearing its kit class ON
// its own element, the shared slip design section's card look (and its old look kept for Bill print and Kitchen
// ticket), buttons that never submit, heading levels, and the WebView / brand bans. The card constants:
// lib/settings-card-layout.test.ts. The behaviour pins (fields, saved option lists, no flips, the draft):
// lib/tokens-settings-paths.test.ts and lib/token-design-editor-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "./source-pin-utils";
import { SETTINGS_BUTTON_CLASS, SETTINGS_HINT_CLASS } from "./settings-card-layout";
import { TOKEN_KIND } from "./print-design-kinds";
import { TOKEN_EDITOR, activate } from "./print-design-editor";
import { settingsOf } from "./print-template-golden.fixtures";
import { DesignSection } from "@/components/settings/print-design/DesignSection";
import type { SlipDesignDraft } from "@/hooks/use-slip-design-draft";
import type { TokenTemplate } from "@pos/shared/print-template";

(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const raw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const read = (rel: string): string => stripComments(raw(rel));
const countOf = (src: string, needle: string): number => src.split(needle).length - 1;

const PAGE = "app/(dashboard)/settings/tokens/page.tsx";
const FIELDS = "components/settings/TokenSettingsFields.tsx";
const SECTION = "components/settings/print-design/TokenDesignSection.tsx";
const DESIGN = "components/settings/print-design/DesignSection.tsx";
const OWNED = [PAGE, FIELDS, SECTION];

test("page file: the wide shell, the card Save bar, ONE stack of form cards beside the sticky slip preview", () => {
  const p = read(PAGE);
  assert.ok(p.includes('<SettingsSectionPage slug="tokens" wide>'), "the wide shell");
  assert.ok(
    p.includes('<SettingsSectionForm settings={settings} section={section} extra={design.extra} saveBarLook="card">'),
    "one form: the design draft rides its Save bar, in the card look",
  );
  assert.equal(countOf(p, "<div className={SETTINGS_PREVIEW_GRID_CLASS}>"), 1, "the root is the preview grid, once");
  assert.match(
    p,
    /<div className=\{cn\(SETTINGS_STACK_CLASS, SETTINGS_MAIN_CARD_CLASS\)\}>\s*<TokenSettingsFields [^>]*\/>\s*<TokenDesignSection [^>]*\/>\s*<\/div>\s*<SettingsCard\s+id="token-preview"/,
    "column 1 holds the fields then the design, and closes before the preview card",
  );
  const link = p.indexOf('href="#token-preview"');
  assert.ok(link > 0 && link < p.indexOf("<div className={cn(SETTINGS_STACK_CLASS"), "the jump link comes first");
  assert.match(p, /className="inline-flex min-h-11 items-center gap-1\.5 justify-self-start text-\[13\.5px\] font-semibold text-primary xl:hidden"\s*>\s*<ArrowDown/);
  assert.match(
    p,
    /<SettingsCard\s+id="token-preview"\s+title="Slip preview"\s+sub="A sample token slip with these settings\. It changes as you edit\."\s+className=\{TOKENS_PREVIEW_CLASS\}\s+bodyClassName="grid gap-3 rounded-b-\[12px\] bg-surface-2 p-3"\s*>/,
    "the preview card: sticky in column 2, its body on --surface-2",
  );
  assert.match(p, /<p className=\{SETTINGS_HINT_CLASS\}>It prints on the same paper as the bill\./, "the paper hint");
  assert.ok(!/\blg:/.test(p) && !p.includes("space-y-6"), "the old lg column is gone");
});

test("cards: Tokens, Daily restart time and Ready tokens, each title and sub once, in order, straight in the stack", () => {
  const f = read(FIELDS);
  assert.equal(countOf(f, "<SettingsCard"), 3, "three cards");
  const cards = [
    '<SettingsCard title="Tokens" sub="A short number for each order, so the customer can be called when it is ready.">',
    '<SettingsCard\n        title="Daily restart time"\n        sub="Token, kitchen ticket and bill numbers all start again from their start number at this time."\n      >',
    '<SettingsCard\n        title="Ready tokens"\n        sub="How long a ready token stays on the token list before it clears by itself."\n      >',
  ];
  const at = cards.map((card) => f.indexOf(card));
  assert.ok(at.every((i, n) => i >= 0 && countOf(f, cards[n]) === 1 && (n === 0 || at[n - 1] < i)), "in order, once each");
  assert.match(f, /return \(\s*<>\s*<SettingsCard/, "a fragment: the cards sit in the page's stack");
  assert.match(
    f,
    /<SettingsSwitchRow\s+label="Give every order a token"\s+sub="Every new order gets a token number\.[^"]*"\s+checked=\{field\.value === true\}\s+onCheckedChange=\{field\.onChange\}\s+\/>/,
    "the switch: the kit row, the same checked rule",
  );
  assert.equal(countOf(f, "<CardField"), 3, "three kit fields");
  assert.match(f, /<SettingsSelect\s+id=\{RESET_TIME_ID\}/, "the restart time: the kit select");
  assert.match(f, /<SettingsSelect\s+id=\{READY_CLEAR_ID\}/, "the ready-clear time: the kit select");
  assert.match(f, /<Input\s+id=\{TOKEN_NUMBER_START_ID\}\s+className=\{cn\(SETTINGS_INPUT_CLASS, CONTROL_WIDTH_CLASS\)\}/);
  assert.equal(countOf(f, "className={CONTROL_WIDTH_CLASS}"), 2, "both selects share the start box's width");
  assert.ok(f.includes('const CONTROL_WIDTH_CLASS = "max-w-60";'));
});

test("hints, the warning and the Now Serving line: each on its own element, inside the Tokens card", () => {
  const f = read(FIELDS);
  assert.match(f, /<p className=\{SETTINGS_HINT_CLASS\}>\{TOKENS_RELOAD_HINT\}<\/p>/);
  assert.match(f, /<p className=\{SETTINGS_HINT_CLASS\}>\{KITCHEN_TOKEN_HINT\}<\/p>/);
  assert.match(f, /<p role="alert" className=\{SETTINGS_ALERT_CLASS\}>\s*\{TOKENS_NO_BILL_PRINTER_WARNING\}\{" "\}\s*<AppLink href="\/printers" className=\{SETTINGS_LINK_CLASS\}>\s*Open Printer setup/);
  const tokensCardEnd = f.indexOf("</SettingsCard>");
  const nowServing = f.indexOf('<NowServingLink variant="hint" />');
  assert.ok(nowServing > f.indexOf('label="Token numbers start at"') && nowServing < tokensCardEnd, "under the start number, before the Tokens card closes");
  const s = read(SECTION);
  assert.ok(s.includes('look="card"'), "the slip design takes the card look");
  assert.ok(s.includes("note={!tokensOn && <p className={SETTINGS_HINT_CLASS}>{TOKENS_OFF_HINT}</p>}"), "the tokens-off line, top of the first card");
});

test("design section: one look table; the old look keeps today's classes, the card look the kit's", () => {
  const d = read(DESIGN);
  const group = d.slice(d.indexOf("  group: {"), d.indexOf("  card: {"));
  const card = d.slice(d.indexOf("  card: {"), d.indexOf("} as const;"));
  assert.ok(group.length > 50 && card.length > 50, "landmark: both looks read");
  for (const line of [
    'alert: "space-y-3 rounded-lg border border-destructive p-3 text-sm text-brand-ink",',
    'notice: "rounded-lg border border-brand-rule bg-brand-wash p-3 text-sm text-brand-ink",',
    "hint: HINT_CLASS,",
    'main: "min-h-11",',
    'outline: "min-h-11",',
    "recovery: RECOVERY_BUTTON_CLASS,",
  ]) assert.ok(group.includes(line), `old look: ${line}`);
  for (const line of [
    'alert: cn(SETTINGS_ALERT_CLASS, "space-y-3"),',
    "notice: SETTINGS_NOTE_CLASS,",
    "hint: SETTINGS_HINT_CLASS,",
    "main: SETTINGS_BUTTON_CLASS,",
    "outline: SETTINGS_OUTLINE_BUTTON_CLASS,",
    "recovery: cn(SETTINGS_OUTLINE_BUTTON_CLASS, RECOVERY_BUTTON_CLASS),",
  ]) assert.ok(card.includes(line), `card look: ${line}`);
  assert.ok(!card.includes("brand-") && !card.includes("destructive"), "the card look has no old colour");
  assert.ok(d.includes('const shown: Look = look ?? "group";') && d.includes("const ui = LOOKS[shown];"), "the default is the old look");
  assert.match(d, /<div role="alert" className=\{ui\.alert\}>/);
  assert.match(d, /<p key=\{notice\} role="status" className=\{ui\.notice\}>/);
  assert.match(d, /<Button type="button" className=\{ui\.main\} onClick=\{\(\) => design\.activate\(kind\.todayDesign, legacy\(\)\)\}>/);
  assert.match(d, /<p className=\{ui\.hint\}>\{copy\.customizeHint\}<\/p>/);
  assert.equal(countOf(d, "className={ui.outline}"), 2, "Reset and Back to standard");
  assert.equal(countOf(d, "<Part look={shown}"), 3, "the three parts");
  assert.equal(countOf(d, "<SettingsGroup"), 1, "the old group only inside Part");
  assert.match(d, /<Part look=\{shown\} title=\{copy\.sectionTitle\} description=\{copy\.sectionDescription\}>\s*\{note\}/, "the note opens the first part");
  assert.ok(d.includes('return shown === "card" ? parts : <div className="space-y-6">{parts}</div>;'), "the old column only in the old look");
});

// The real section, rendered both ways over the token kind (a draft stub: the hook's state is not under test here).
function renderSection(look: "card" | undefined, draft: TokenTemplate | null, note?: string): string {
  const design = {
    baseline: null, draft, active: draft !== null, dirty: false, unreadable: true, notices: ["Switched on: the token number."], issues: [],
    set: () => {}, activate: () => {}, backToToday: () => {}, recoverClassic: () => {}, keepToday: () => {},
    extra: { dirty: false, body: () => ({}), problem: () => null, saved: () => {}, discard: () => {} },
  } as unknown as SlipDesignDraft<TokenTemplate>;
  const settings = settingsOf();
  return renderToStaticMarkup(
    createElement(DesignSection<TokenTemplate>, {
      kind: TOKEN_KIND, design, settings, legacy: () => settings, gallery: () => createElement("ul", { "data-gallery": "" }), look,
      note: note === undefined ? undefined : createElement("p", null, note),
    }),
  );
}

test("design section renders: the card look is three h2 cards in the kit look; the old look keeps its h3 groups", () => {
  const draft = activate(TOKEN_EDITOR, "bigNumber", settingsOf()).template;
  const card = renderSection("card", draft, "Turn on tokens above.");
  assert.equal(card.match(/<h2\b/g)?.length, 3, "three cards");
  assert.ok(card.includes('<ul data-gallery="">') && !card.includes("<h3"), "no old group heading (landmark: the gallery drew)");
  assert.ok(!card.startsWith('<div class="space-y-6">') && card.startsWith("<section"), "the cards sit straight in the stack");
  assert.ok(card.indexOf("Turn on tokens above.") < card.indexOf('role="alert"'), "the note opens the first card");
  assert.ok(card.includes('class="rounded-[10px] border border-border-2 bg-surface-2'), "the notice in the note look");
  const old = renderSection(undefined, draft);
  assert.ok(old.startsWith('<div class="space-y-6">'), "the old look keeps its column");
  assert.equal(old.match(/<h3\b/g)?.length, 3, "three old groups");
  assert.ok(!old.includes("<h2") && old.includes("text-brand-ink"), "the old look is untouched (landmark: its colours)");
  const start = renderSection("card", null);
  assert.ok(start.includes(`class="${SETTINGS_HINT_CLASS}"`) && start.includes(SETTINGS_BUTTON_CLASS), "Customize: the kit button and hint");
  assert.equal(start.match(/<h2\b/g)?.length, 1, "before Customize: one card");
  // The line editor, font and size pieces are shared with Bill print and Kitchen ticket and keep their look until those
  // pages move (the plan's scope), so the colour check reads the section's own parts: the render before Customize.
  assert.ok(start.includes('role="alert"') && start.includes('role="status"'), "landmark: the alert and notice drew");
  assert.ok(!start.includes("brand-") && !start.includes("destructive"), "no old colour in the section's own parts");
});

test("buttons: each is type=button first", () => {
  let total = 0;
  for (const rel of [...OWNED, DESIGN]) {
    const s = read(rel);
    const buttons = s.match(/<[bB]utton\b/g) ?? [];
    const typed = s.match(/<[bB]utton\s+type="button"/g) ?? [];
    assert.equal(typed.length, buttons.length, `${rel}: each <button> / <Button> starts with type="button"`);
    total += buttons.length;
  }
  assert.equal(total, 6, "landmark: the design section's Try again, 2 recovery, Customize, Reset, Back to standard");
});

test("headings: the cards are the only headings; nothing raw in the owned files", () => {
  for (const rel of [...OWNED, DESIGN]) {
    const s = read(rel);
    assert.ok(s.includes("export"), `${rel}: read (landmark)`);
    assert.ok(!/<h[1-6]\b/.test(s), `${rel}: no raw heading`);
  }
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, /NN colour opacity, old kit pieces", () => {
  for (const rel of OWNED) {
    const s = raw(rel);
    assert.ok(s.length > 0 && s.includes("export"), `${rel}: read raw, comments included (landmark)`);
    assert.ok(!s.includes("color-mix"), `${rel}: no color-mix()`);
    assert.ok(!s.includes("light-dark("), `${rel}: no light-dark()`);
    assert.ok(!s.includes("backdrop-blur"), `${rel}: no backdrop-blur`);
    assert.ok(!s.includes("overflow-" + "hidden"), `${rel}: overflow-clip, never the hidden one`);
    assert.ok(!s.includes("brand-"), `${rel}: no brand-* class`);
    assert.ok(!/\bBRAND_/.test(s), `${rel}: no BRAND_* class constant`);
    assert.ok(!/<select\b/.test(s), `${rel}: the kit Select, never a native <select>`);
    const opacity = s.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/);
    assert.equal(opacity, null, `${rel}: no /NN opacity modifier on a colour (found ${opacity?.[0]})`);
    const code = read(rel);
    for (const old of [/\bSettingsGroup\b/, /\bToggleRow\b/, /\bSettingsFields"/, /\bhint-classes\b/, /<Field\b/]) {
      assert.ok(!old.test(code), `${rel}: no ${old.source} in the code (the old look)`);
    }
    assert.ok(!/\bHINT_CLASS\b/.test(code), `${rel}: SETTINGS_HINT_CLASS, not the old HINT_CLASS`);
  }
  // The shared section keeps the old look's colours for Bill print and Kitchen ticket, so it takes only the WebView bans.
  const d = raw(DESIGN);
  assert.ok(d.includes("const LOOKS = {"), "landmark: the shared section read raw");
  for (const banned of ["color-mix", "light-dark(", "backdrop-blur", "overflow-" + "hidden"]) assert.ok(!d.includes(banned), `${DESIGN}: no ${banned}`);
  assert.equal(d.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/), null, `${DESIGN}: no /NN colour opacity`);
});

test("every touched file stays within 300 lines", () => {
  const touched = [
    ...OWNED,
    DESIGN,
    "lib/settings-card-layout.ts",
    "lib/settings-tokens-layout.test.ts",
    "lib/settings-card-layout.test.ts",
    "lib/settings-business-layout.test.ts",
  ];
  for (const rel of touched) {
    const lines = readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length - 1;
    assert.ok(lines > 10, `${rel}: read (landmark)`);
    assert.ok(lines <= 299, `${rel} is ${lines} lines (wc -l <= 299)`);
  }
});
