// Settings > Business details in the new UI (docs/superpowers/plans/2026-11-06-settings-business-ui.md): the page's card
// order and the sticky Bill preview, the anchors other pages link to, the words that must not change, the WebView /
// brand bans, and that only this page opts into the card Save bar. The card constants: lib/settings-card-layout.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
const COMPONENT = (name: string): string => `components/settings/${name}.tsx`;

const BUSINESS = COMPONENT("BusinessDetailsFields");
const SCREENS = COMPONENT("ScreensSettingsCard");
const UPI_CARD = COMPONENT("UpiPaymentsCard");
const UPI_RULES = COMPONENT("UpiRulesFields");
const PAY_QR = COMPONENT("PayQrFields");
const LAYOUT_PICKER = COMPONENT("PosLayoutPicker");
const CARD = COMPONENT("SettingsCard");
const SAVE_BAR = COMPONENT("SettingsSaveBar");
const SECTION_FORM = COMPONENT("SettingsSectionForm");
const LAYOUT = "lib/settings-card-layout.ts";
const BUSINESS_PAGE = "app/(dashboard)/settings/business/page.tsx";

// The new and restyled files (the Save bar keeps its classic look's strings, so it is checked on its own below).
const BANNED_IN = [LAYOUT, CARD, UPI_CARD, SCREENS, BUSINESS, UPI_RULES, PAY_QR, LAYOUT_PICKER];

test("page: root grid, then Restaurant, Contact, Bill preview, UPI payments, Screens, App branding in that DOM order", () => {
  const s = read(BUSINESS);
  assert.ok(s.includes("className={BUSINESS_GRID_CLASS}"), "the root is the grid");
  const order = [
    'title="Restaurant"',
    'title="Contact & licence"',
    'title="Bill preview"',
    "<UpiPaymentsCard",
    "<ScreensSettingsCard",
    'title="App branding"',
  ].map((needle) => {
    assert.ok(s.includes(needle), `BusinessDetailsFields has ${needle}`);
    return s.indexOf(needle);
  });
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `card ${i} follows card ${i - 1}`);
  const mainUses = s.split("className={BUSINESS_MAIN_CARD_CLASS}").length - 1;
  assert.equal(mainUses, 5, "the five form cards each take BUSINESS_MAIN_CARD_CLASS");
  assert.equal(s.split("BUSINESS_PREVIEW_CLASS").length - 1, 2, "BUSINESS_PREVIEW_CLASS: the import and the one preview card");
  assert.ok(s.includes("className={BUSINESS_PREVIEW_CLASS}"), "the preview card wears the preview class");
  assert.ok(s.includes('bodyClassName="rounded-b-[12px] bg-surface-2 p-3"'), "the preview body sits on --surface-2");
  assert.ok(s.includes('settingsSectionPath("bill-print")') && s.includes("SETTINGS_LINK_CLASS"), "the Bill print link");
  assert.ok(s.includes("<BillHeaderPreview control={control} settings={settings} />"), "the preview component is untouched");
  // A stretched grid row hands a hint-less field's spare height to its label row: Contact mobile's box sat lower than
  // FSSAI's (1280 px shot, 2026-11-06). Side-by-side field rows are top-aligned.
  assert.ok(s.includes('"grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start"'), "logo | name row is top-aligned");
  assert.ok(s.includes('"grid gap-4 sm:grid-cols-2 sm:items-start"'), "mobile | FSSAI row is top-aligned");
});

test("page: both ImageUpload controllers stay in BusinessDetailsFields (branding-paths pins them there)", () => {
  const s = read(BUSINESS);
  assert.ok(/slot="logo"/.test(s) && /name="logo"/.test(s), "restaurant logo slot and name");
  assert.ok(/slot="productLogo"/.test(s) && /name="productLogo"/.test(s), "product logo slot and name");
});

test("anchors: Tables screen and Screen lock keep their ids; Setup's Change link still lands on #tables-screen", () => {
  const s = read(SCREENS);
  assert.ok(s.includes('id="tables-screen"'), "id tables-screen in ScreensSettingsCard");
  assert.ok(s.includes('id="screen-lock"'), "id screen-lock in ScreensSettingsCard");
  assert.ok(s.indexOf('id="tables-screen"') < s.indexOf('id="screen-lock"'), "Tables screen before Screen lock");
  const setup = read("app/(dashboard)/tables/setup/page.tsx");
  assert.ok(setup.includes('`${settingsSectionPath("business")}#tables-screen`'), "the tables/setup link targets #tables-screen");
});

test("words and ids: the form's own text, ids and input attributes are kept", () => {
  const b = read(BUSINESS);
  for (const word of [
    "Your name, logo and tagline. They print at the top of every bill.",
    "On bills, kitchen tickets and the sidebar.",
    "Printed under your name on bills.",
    "Printed on the bill when set.",
    "Contact mobile",
    "FSSAI licence number",
    "How the top of a bill looks. Choose which lines print in",
    "Bill print",
    "Never printed on bills.",
    "Shown in the browser tab and on the login screen. A square image works best.",
    "settings-restaurant-name",
    "settings-tagline",
    "settings-address",
    "settings-mobile",
    "settings-fssai",
  ]) assert.ok(b.includes(word), `BusinessDetailsFields keeps "${word}"`);
  assert.ok(b.includes('type="tel"') && b.includes('inputMode="tel"'), "mobile keeps type=tel inputMode=tel");

  const u = read(UPI_CARD);
  assert.ok(u.includes("settings-upiId") && u.includes('register("upiId")'), "the UPI ID input keeps its id and field");
  for (const attr of ['autoCapitalize="none"', 'autoCorrect="off"', "spellCheck={false}"]) {
    assert.ok(u.includes(attr), `the UPI ID input keeps ${attr}`);
  }
  assert.ok(u.includes("For the Scan to pay QR on bills. Example: yourshop@okaxis"), "the UPI ID hint");
  assert.ok(u.includes("Customers scan the QR on a bill and pay to these UPI IDs."), "the card sub");
  assert.ok(u.includes('title="Pay QR on bills"') && u.includes("When a bill prints a QR, and how long it works."), "the Pay QR block");
  assert.ok(u.includes("<UpiRulesFields") && u.includes("<PayQrFields"), "the slab editor and the pay QR fields render here");
  assert.ok(u.indexOf("<UpiRulesFields") > u.indexOf('register("upiId")'), "the slabs sit under the UPI ID");

  const sc = read(SCREENS);
  for (const word of [
    "How the app's screens work for your staff.",
    'title="New order screen"',
    "How items are laid out when staff start a new order.",
    'title="Tables screen"',
    "How the live floor flags tables.",
    'title="Screen lock"',
    "The screen locks when nobody has touched it for a while. Staff unlock with their PIN.",
    "Lock the screen after no activity for",
    "Long stay alert",
    "minutes",
    "settings-long-stay",
    "settings-screen-lock",
    'register("tableLongStayMinutes", { valueAsNumber: true })',
    'inputMode="numeric"',
  ]) assert.ok(sc.includes(word), `ScreensSettingsCard keeps ${word}`);

  const rules = read(UPI_RULES);
  for (const word of [
    "Different UPI ID by bill amount (optional)",
    "For example, bills up to ₹500 pay to one ID and bills up to ₹2000 to another. Bills above your highest",
    "amount use the main UPI ID.",
    "Bills up to ₹",
    "aria-label={`Remove amount slab ${index + 1}`}",
    "aria-invalid={amountError !== undefined}",
    "aria-invalid={upiIdError !== undefined}",
    'role="alert"',
    "Add an amount slab",
    "You can have up to {UPI_RULES_MAX} slabs.",
    "Add the main UPI ID above first.",
    "disabled={atMax || !hasMain}",
    "raw.trim() === \"\" ? BLANK_AMOUNT : Number(raw)",
  ]) assert.ok(rules.includes(word), `UpiRulesFields keeps ${word}`);
  assert.ok(rules.includes("<SettingsBlock"), "UpiRulesFields renders its own SettingsBlock");

  const qr = read(PAY_QR);
  for (const word of [
    "When to print the pay QR",
    "Always: every bill gets one, and a fully paid bill asks for the full total. A cancelled bill never gets one.",
    "Minutes valid",
    "No time limit.",
    "No limit",
    "The QR prints on every reprint, with no Valid till line.",
    "settings-pay-qr-mode",
    "settings-pay-qr-minutes",
    "minutesFromInput",
    "PAY_QR_NO_LIMIT",
    'tone="accent"',
    "SETTINGS_SWITCH_ROW_CLASS",
    "aria-describedby={noLimitLineId}",
  ]) assert.ok(qr.includes(word), `PayQrFields keeps ${word}`);
  assert.ok(qr.includes("<label") && qr.includes("MenuSwitch"), "the No limit row is a label around the switch");

  const picker = read(LAYOUT_PICKER);
  for (const word of ["<fieldset>", "New order screen layout", 'type="radio"', "All items in one grid.", "By category"]) {
    assert.ok(picker.includes(word), `PosLayoutPicker keeps ${word}`);
  }
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, native select or /NN colour opacity", () => {
  for (const rel of BANNED_IN) {
    const s = read(rel);
    assert.ok(!s.includes("color-mix"), `${rel}: no color-mix()`);
    assert.ok(!s.includes("light-dark("), `${rel}: no light-dark()`);
    assert.ok(!s.includes("backdrop-blur"), `${rel}: no backdrop-blur`);
    assert.ok(!s.includes("overflow-hidden"), `${rel}: overflow-clip, never overflow-hidden`);
    assert.ok(!s.includes("brand-"), `${rel}: no brand-* class`);
    assert.ok(!/<select\b/.test(s), `${rel}: the kit Select, never a native <select>`);
    const opacity = s.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/);
    assert.equal(opacity, null, `${rel}: no /NN opacity modifier on a colour (found ${opacity?.[0]})`);
  }
});

test("Save bar: the card look is opt-in; the classic look keeps today's classes for both looks' offset", () => {
  const s = read(SAVE_BAR);
  assert.ok(s.includes("export type SettingsSaveBarLook"), "the look type is exported");
  assert.ok(/look\?:\s*SettingsSaveBarLook/.test(s), "look is an optional prop");
  assert.ok(s.includes("BRAND_CONTROL_CLASS"), "the classic buttons keep BRAND_CONTROL_CLASS");
  assert.ok(s.includes("rounded-lg border border-brand-rule bg-brand-slip/95"), "the classic bar's own classes are unchanged");
  assert.ok(/ABOVE_TAB_BAR_STICKY_CLASS,\s*\)\}/.test(s), "the offset is applied to the bar for both looks");
  assert.ok(s.includes("SETTINGS_SAVE_BAR_CARD_CLASS"), "the card look reads the constant");
  for (const word of ["Unsaved changes", "Discard", "Save changes"]) assert.ok(s.includes(word), `the bar keeps "${word}"`);
  const form = read(SECTION_FORM);
  assert.ok(/saveBarLook\?:\s*SettingsSaveBarLook/.test(form), "SettingsSectionForm takes saveBarLook");
  assert.ok(form.includes("look={saveBarLook}"), "and passes it to the bar");
});

test("page file: Business is wide and uses the card Save bar", () => {
  const p = read(BUSINESS_PAGE);
  assert.ok(/<SettingsSectionPage slug="business" wide>/.test(p), "the page is wide");
  assert.ok(p.includes('saveBarLook="card"'), "the page opts into the card Save bar");
});

test("scope: no other settings page passes saveBarLook", () => {
  const root = path.join(CAFE_ROOT, "app/(dashboard)/settings");
  const pages: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) pages.push(path.join(entry.name, "page.tsx"));
  }
  assert.ok(pages.length >= 9, `found the settings pages (${pages.length})`);
  for (const rel of pages) {
    const s = stripComments(readFileSync(path.join(root, rel), "utf8"));
    const passes = s.includes("saveBarLook");
    assert.equal(passes, rel.startsWith("business"), `${rel}: saveBarLook only on the business page`);
  }
});

test("every touched file stays within 300 lines", () => {
  const tests = ["lib/settings-business-layout.test.ts", "lib/settings-card-layout.test.ts"];
  for (const rel of [...BANNED_IN, SAVE_BAR, SECTION_FORM, BUSINESS_PAGE, "components/menu/MenuSwitch.tsx", ...tests]) {
    const lines = readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length - 1;
    assert.ok(lines <= 299, `${rel} is ${lines} lines (wc -l <= 299)`);
  }
});
