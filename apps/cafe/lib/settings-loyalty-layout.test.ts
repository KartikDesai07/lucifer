// Settings > Rewards & loyalty in the new UI (docs/superpowers/plans/2026-11-09-settings-loyalty-ui.md): the page shell,
// the five cards in order, each note / error / empty box / hint wearing its kit class ON its own element, the buttons that
// must never submit, the heading levels, the card look of the reward number field, and the WebView / brand bans. The card
// constants: lib/settings-card-layout.test.ts. The behaviour pins (switch locks, panels, drafts): lib/loyalty-settings-
// paths.test.ts, lib/reward-levels-ui-paths.test.ts and lib/reward-levels-unlock.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const countOf = (src: string, needle: string): number => src.split(needle).length - 1;

const PAGE = "app/(dashboard)/settings/loyalty/page.tsx";
const CARD = "components/settings/LoyaltyCard.tsx";
const GRID = "components/settings/LoyaltyStampGrid.tsx";
const BOX = "components/settings/LoyaltyStampBox.tsx";
const SECTION = "components/settings/rewards/RewardLevelsSection.tsx";
const LEVEL = "components/settings/rewards/RewardLevelGrid.tsx";
const STARTERS = "components/settings/rewards/RewardStarterButtons.tsx";
const NUMBER = "components/settings/rewards/RewardNumberField.tsx";
const PARTS = [CARD, GRID, BOX, SECTION, LEVEL, STARTERS];
const OWNED = [PAGE, ...PARTS];

test("page file: the wide shell, the card Save bar, one stack of the three parts riding the levels draft", () => {
  const p = read(PAGE);
  assert.ok(p.includes('<SettingsSectionPage slug="loyalty" wide>'), "the wide shell: the stamp boxes fill the row");
  assert.ok(
    p.includes('<SettingsSectionForm settings={settings} section={section} extra={levels.extra} saveBarLook="card">'),
    "one form: the levels draft rides its Save bar, in the card look",
  );
  const root = "<div className={SETTINGS_STACK_CLASS}>";
  assert.equal(countOf(p, root), 1, "the root is the one-column stack, once");
  const at = [root, "<LoyaltyCard ", "<LoyaltyStampGrid ", "<RewardLevelsSection "].map((needle) => p.indexOf(needle));
  assert.ok(at.every((i, n) => i >= 0 && (n === 0 || at[n - 1] < i)), "the stack, then the card, the stamp rewards, the levels");
  assert.ok(!p.includes("space-y-6"), "the old column is gone");
});

test("cards: Diner accounts, Stamp card, Rewards, Scratch cards and Levels, each title and sub once, in order", () => {
  const cards: Array<[string, number, string, string]> = [
    [CARD, 2, 'title="Diner accounts"', 'sub="Sign-in on the QR menu. The stamp card needs it."'],
    [CARD, 2, 'title="Stamp card"', 'sub="Diners collect stamps on their bills and earn rewards along the way."'],
    [GRID, 1, 'title="Rewards"', 'sub="Tap a box to choose what a diner gets when they reach it. The card starts again once it is full."'],
    [SECTION, 2, 'title="Scratch cards"', 'sub="Diners scratch a card for a surprise reward as they keep coming back. Set up the levels below."'],
    [
      SECTION,
      2,
      'title="Levels"',
      'sub="A card with boxes. Tap a box to say what diners can win there. Each level is a fresh card with its own boxes."',
    ],
  ];
  for (const [rel, count, title, sub] of cards) {
    const s = read(rel);
    assert.equal(countOf(s, "<SettingsCard"), count, `${rel}: ${count} card(s)`);
    assert.equal(countOf(s, title), 1, `${title} appears once`);
    assert.equal(countOf(s, sub), 1, `${title}: its sub appears once`);
    assert.ok(s.indexOf(title) < s.indexOf(sub), `${title} comes before its sub`);
    assert.ok(new RegExp(`<SettingsCard\\s+${title}\\s+${sub.replace(/[.()?]/g, "\\$&")}`).test(s), `${title}: the card's own title and sub`);
  }
  const card = read(CARD);
  assert.ok(card.indexOf('title="Diner accounts"') < card.indexOf('title="Stamp card"'), "Diner accounts before Stamp card");
  const section = read(SECTION);
  assert.ok(section.indexOf('title="Scratch cards"') < section.indexOf('title="Levels"'), "Scratch cards before Levels");
  assert.match(section, /\{cfg !== null && \(\s*<SettingsCard\s+title="Levels"/, "Levels only once a setup exists");
});

test("switch rows: the three switches are kit SettingsSwitchRows; the two locks are passed as disabled", () => {
  const card = read(CARD);
  const section = read(SECTION);
  assert.equal(countOf(card, "<SettingsSwitchRow"), 2, "sign-in and the stamp card");
  assert.equal(countOf(section, "<SettingsSwitchRow"), 1, "the scratch-card switch");
  const stamp = /<SettingsSwitchRow\s+label="Turn on the stamp card"[\s\S]*?\/>/.exec(card)?.[0] ?? "";
  assert.ok(stamp.includes("disabled={!accountsOn}"), "the stamp switch locks while sign-in is off");
  const scratch = /<SettingsSwitchRow\s+label=\{SWITCH_LABEL\}[\s\S]*?\/>/.exec(section)?.[0] ?? "";
  assert.ok(scratch.includes("disabled={!switchable || (blockedText !== null && !switchChecked)}"), "the scratch lock");
});

test("notes, errors, empty boxes and hints: each wears its kit class on its own element", () => {
  const card = read(CARD);
  const grid = read(GRID);
  const section = read(SECTION);
  const level = read(LEVEL);
  const starters = read(STARTERS);
  const on: Array<[string, string, RegExp]> = [
    [CARD, card, /<p className=\{SETTINGS_NOTE_CLASS\} role="status">\s*\{LEVELS_ON_NOTE\}/],
    [SECTION, section, /<p className=\{SETTINGS_NOTE_CLASS\} role="status">\s*\{blockedText\}/],
    [SECTION, section, /<div className=\{cn\(SETTINGS_NOTE_CLASS, "space-y-3"\)\} role="status">\s*<p>\{UNREADABLE_NOTICE\}<\/p>/],
    [SECTION, section, /<div className=\{cn\(SETTINGS_NOTE_CLASS, "space-y-2"\)\} role="status">\s*<p className="font-medium">Some of/],
    [SECTION, section, /<p className=\{SETTINGS_NOTE_CLASS\} role="status">\s*\{levels\.positionWarning\}/],
    [GRID, grid, /<p className=\{SETTINGS_ERROR_CLASS\} role="alert">\s*\{arrayError\}/],
    [SECTION, section, /<p className=\{SETTINGS_ERROR_CLASS\} role="alert">\s*\{`Fix this before you save\. /],
    [LEVEL, level, /<p className=\{SETTINGS_ERROR_CLASS\} role="alert">\s*\{levelError\}/],
    [GRID, grid, /<p className=\{SETTINGS_LIST_EMPTY_CLASS\}>\s*Set how many stamps fill the card to draw it\./],
    [GRID, grid, /<p className=\{SETTINGS_LIST_EMPTY_CLASS\}>\s*No rewards yet\. Tap a box to add one\./],
    [LEVEL, level, /<p className=\{SETTINGS_LIST_EMPTY_CLASS\}>\s*Set how many boxes this level has to draw it\./],
    [GRID, grid, /<p className=\{SETTINGS_HINT_CLASS\}>\{`\$\{fields\.length\} of /],
    [GRID, grid, /<p className=\{SETTINGS_HINT_CLASS\}>\s*\{`You can place up to /],
    [GRID, grid, /<p className=\{SETTINGS_HINT_CLASS\}>Changes save when you press Save changes\.<\/p>/],
    [SECTION, section, /<p className=\{SETTINGS_HINT_CLASS\}>\s*\{cfg\.levels\.length >= REWARD_LEVELS_MAX/],
    [SECTION, section, /<p className=\{SETTINGS_LABEL_CLASS\}>Start from a ready-made setup<\/p>/],
    [LEVEL, level, /<p className=\{SETTINGS_HINT_CLASS\}>\s*\{atSlotMax/],
    [STARTERS, starters, /<p className=\{SETTINGS_HINT_CLASS\}>You can change everything afterwards\./],
  ];
  for (const [rel, s, re] of on) assert.match(s, re, `${rel}: ${re.source.slice(0, 60)}`);
  assert.equal(countOf(section, "SETTINGS_NOTE_CLASS"), 5, "the import + four notes in the scratch-card cards");
  assert.equal(countOf(card, '<div className="grid items-start gap-4 sm:grid-cols-2">'), 1, "the three fields: top-aligned pairs");
});

test("buttons: each is type=button first, in the card look on its own element", () => {
  let total = 0;
  for (const rel of PARTS) {
    const s = read(rel);
    const buttons = s.match(/<[bB]utton\b/g) ?? [];
    const typed = s.match(/<[bB]utton\s+type="button"/g) ?? [];
    assert.equal(typed.length, buttons.length, `${rel}: each <button> / <Button> starts with type="button"`);
    total += buttons.length;
  }
  assert.equal(total, 12, "landmark: panel 4 + box 1 + scratch cards 4 + level 1 + starters 2");
  const section = read(SECTION);
  assert.match(section, /<button type="button" className=\{SETTINGS_REMOVE_BUTTON_CLASS\} onClick=\{\(\) => setConfirmOpen\(true\)\}>\s*Start over\s*<\/button>/);
  assert.match(section, /<button\s+type="button"\s+className=\{SETTINGS_ADD_BUTTON_CLASS\}\s+disabled=\{cfg\.levels\.length >= REWARD_LEVELS_MAX\}/);
  assert.match(section, /className=\{SETTINGS_OUTLINE_BUTTON_CLASS\} onClick=\{\(\) => levels\.replace\(null\)\}>\s*Start over/);
  assert.match(section, /className=\{SETTINGS_OUTLINE_BUTTON_CLASS\} onClick=\{\(\) => setCopyNotes\(\[\]\)\}>\s*Dismiss/);
  assert.match(
    read(LEVEL),
    /<button\s+type="button"\s+className=\{cn\(SETTINGS_REMOVE_BUTTON_CLASS, "w-\[42px\] shrink-0 px-0"\)\}\s+aria-label=\{`Remove level /,
    "Remove level: a 42px square in the remove look",
  );
  assert.match(read(STARTERS), /const BUTTON_CLASS = cn\(\s*SETTINGS_OUTLINE_BUTTON_CLASS,/, "the starters grow the plain card button");
  const removeReward = read(GRID).split("<Button").find((seg) => /Remove reward\s*<\/Button>/.test(seg)) ?? "";
  assert.ok(
    removeReward.includes("className={`${FOOTER_BUTTON_CLASS} text-status-bad-ink hover:text-status-bad-ink`}"),
    "the panel's Remove reward keeps the bad ink on its own button",
  );
});

test("headings: the cards are the h2s; only 'Level N' is an h3, and nothing sits below h3", () => {
  for (const rel of OWNED) {
    const s = read(rel);
    assert.ok(s.includes("export"), `${rel}: read (landmark)`);
    assert.ok(!/<h[4-6]\b/.test(s), `${rel}: no h4-h6 inside a card`);
  }
  const level = read(LEVEL);
  assert.equal(level.match(/<h[1-6]\b/g)?.length, 1, "one heading in a level");
  assert.ok(level.includes("<h3 className={SETTINGS_BLOCK_TITLE_CLASS}>{`Level ${levelIndex + 1}`}</h3>"), "Level N is an h3");
  for (const rel of [CARD, GRID, BOX, SECTION, STARTERS]) assert.ok(!/<h[1-6]\b/.test(read(rel)), `${rel}: no raw heading`);
});

test("stamp box: a reward on the tile's selected colours, an empty box dashed, an error solid red, the kit focus ring", () => {
  const button = /<button\s+type="button"[^>]*?className=\{cn\(([\s\S]*?)\)\}\s*>/.exec(read(BOX))?.[1] ?? "";
  assert.ok(button.includes("aspect-square"), "landmark: the box button's own class list");
  assert.match(
    button,
    /hasReward\s*\?\s*"border-primary bg-status-info-tint font-semibold text-foreground"\s*:\s*"border-dashed border-subtle-foreground text-muted-foreground",/,
  );
  assert.ok(button.includes("`enabled:pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS}`,"), "hover and focus ring");
  assert.ok(button.includes('hasError && "border-solid border-status-bad",'), "an error box");
  assert.ok(button.includes("rounded-[10px] border-2"), "radius 10, the 2px rule");
});

test("reward number field: the card look only where asked (Scratch cards, Levels); panels and festival cards keep theirs", () => {
  const n = read(NUMBER);
  assert.ok(n.includes('look?: "card";'), "an optional look");
  assert.ok(n.includes('className={look === "card" ? SETTINGS_INPUT_CLASS : REWARD_FIELD_CLASS}'), "the input look follows it");
  assert.match(n, /return look === "card" \? \(\s*<CardField label=\{label\} htmlFor=\{id\} error=\{error \?\? undefined\} hint=\{hint\}>/);
  assert.match(n, /\) : \(\s*<Field label=\{label\} htmlFor=\{id\} error=\{error \?\? undefined\} hint=\{hint\}>/);
  assert.match(read(SECTION), /<RewardNumberField\s+label="Bills of at least \(₹\)"[^/]*look="card"/, "the minimum bill");
  assert.match(read(LEVEL), /<RewardNumberField\s+label="Boxes"[^/]*look="card"/, "the level's box count");
  const keep = [
    "components/settings/rewards/RewardRangeFields.tsx",
    "components/settings/rewards/RewardOptionLimits.tsx",
    "components/settings/rewards/RewardTtlFields.tsx",
    "components/settings/rewards/RewardCostPreview.tsx",
    "components/settings/rewards/RewardOptionFields.tsx",
    "components/customers/festival/FestivalCardForm.tsx",
  ];
  for (const rel of keep) {
    const s = read(rel);
    assert.ok(s.includes("<RewardNumberField"), `${rel}: uses the field (landmark)`);
    assert.ok(!s.includes('look="card"'), `${rel}: keeps the default look`);
  }
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, /NN colour opacity, old kit pieces", () => {
  for (const rel of OWNED) {
    const s = readFileSync(path.join(CAFE_ROOT, rel), "utf8");
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
    for (const old of ["SettingsGroup", "ToggleRow", "SettingsFields", "hint-classes", "REWARD_NOTE_CLASS", "REWARD_BUTTON_CLASS"]) {
      assert.ok(!code.includes(old), `${rel}: no ${old} in the code (the old look)`);
    }
    assert.ok(!/\bHINT_CLASS\b/.test(code), `${rel}: SETTINGS_HINT_CLASS, not the old HINT_CLASS`);
  }
});

test("every touched file stays within 300 lines", () => {
  const touched = [
    ...OWNED,
    NUMBER,
    "components/settings/SettingsCard.tsx",
    "lib/settings-card-layout.ts",
    "lib/settings-loyalty-layout.test.ts",
    "lib/settings-card-layout.test.ts",
    "lib/reward-levels-ui-paths.test.ts",
    "lib/reward-levels-unlock.test.ts",
    "lib/settings-business-layout.test.ts",
  ];
  for (const rel of touched) {
    const lines = readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length - 1;
    assert.ok(lines > 10, `${rel}: read (landmark)`);
    assert.ok(lines <= 299, `${rel} is ${lines} lines (wc -l <= 299)`);
  }
});
