// Settings > QR ordering in the new UI (docs/superpowers/plans/2026-11-08-settings-qr-ui.md): the page shell, the four
// cards in order, the mode tiles, the list rows, the switch rows, the words / ids / input attributes that must not
// change, and the WebView / brand bans. The card constants: lib/settings-card-layout.test.ts. The behaviour pins
// (modes, kinds, confirm-before-remove): lib/qr-ordering-settings-paths.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));

const PAGE = "app/(dashboard)/settings/qr-ordering/page.tsx";
const SELF_ORDER = "components/settings/SelfOrderCard.tsx";
const PROMO_LIST = "components/settings/PromoCodesFields.tsx";
const PROMO_ROW = "components/settings/PromoCodeRow.tsx";
const BANNERS = "components/settings/DinerBannersFields.tsx";
const UPI_RULES = "components/settings/UpiRulesFields.tsx";
const OWNED = [PAGE, SELF_ORDER, PROMO_LIST, PROMO_ROW, BANNERS];

test("page file: QR ordering stays in the narrow shell, uses the card Save bar and one stack of the three parts", () => {
  const p = read(PAGE);
  assert.ok(p.includes('<SettingsSectionPage slug="qr-ordering">'), "the page is the qr-ordering section (landmark)");
  assert.ok(!/<SettingsSectionPage\b[^>]*\bwide\b/.test(p), "the page is not wide: it has no preview column");
  assert.ok(p.includes('saveBarLook="card"'), "the page opts into the card Save bar");
  assert.ok(p.includes("<div className={SETTINGS_STACK_CLASS}>"), "the root is the one-column stack");
  const at = ["<SelfOrderCard", "<PromoCodesFields", "<DinerBannersFields"].map((needle) => {
    assert.equal(p.split(needle).length - 1, 1, `the page renders ${needle} once`);
    return p.indexOf(needle);
  });
  assert.ok(at[0] < at[1] && at[1] < at[2], "Ordering/Tables, then Promo codes, then Announcements");
  assert.ok(p.indexOf("<div className={SETTINGS_STACK_CLASS}>") < at[0], "all three sit inside the stack");
});

test("cards: Ordering, Tables, Promo codes and Announcements, each title and sub once, in order", () => {
  const self = read(SELF_ORDER);
  const cards: Array<[string, string, string]> = [
    [self, 'title="Ordering"', 'sub="What happens when a diner orders from the menu on their phone."'],
    [self, 'title="Tables"', `sub="For diners who open the menu link without scanning a table's QR code."`],
    [read(PROMO_LIST), 'title="Promo codes"', 'sub="Codes a diner can type when ordering from the QR code."'],
    [
      read(BANNERS),
      'title="Announcements"',
      "sub={`Short lines diners see on the Home tab of the QR menu, like a special offer. Up to ${DINER_BANNER_MAX}.`}",
    ],
  ];
  for (const [src, title, sub] of cards) {
    assert.equal(src.split(title).length - 1, 1, `${title} appears once`);
    assert.equal(src.split(sub).length - 1, 1, `${title}: its sub appears once`);
    assert.ok(src.indexOf(title) < src.indexOf(sub), `${title} comes before its sub`);
  }
  assert.ok(self.indexOf('title="Ordering"') < self.indexOf('title="Tables"'), "Ordering comes before Tables");
});

test("tiles: the mode tiles wear the shared tile look as a row; the three modes keep their words", () => {
  const s = read(SELF_ORDER);
  for (const needle of [
    'const MODE_TILE_CLASS = "min-h-11 flex-row items-start gap-3";',
    "className={cn(SETTINGS_TILE_CLASS, MODE_TILE_CLASS, selected ? SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS)}",
    "selected ? SETTINGS_TILE_RADIO_ON_CLASS : SETTINGS_TILE_RADIO_OFF_CLASS",
    "SETTINGS_TILE_RADIO_CLASS",
    "{selected && <span className={SETTINGS_TILE_DOT_CLASS} />}",
    'label: "Staff accepts each order"',
    "The order waits in Order Requests until someone accepts it.",
    'label: "Straight to the kitchen"',
    "The order is accepted at once, the same as an order taken at the counter. If that fails, it waits in Order Requests.",
    'label: "Menu only"',
    "Diners see the menu and prices but can't order. Good for replacing a paper menu.",
    '<legend className="sr-only">When a diner places an order</legend>',
    'className="sr-only"',
    "aria-describedby={`${name}-${option}-description`}",
    "Recommended",
  ]) assert.ok(s.includes(needle), `SelfOrderCard keeps ${needle}`);
});

test("rows: promo, announcement and UPI slab rows share the list-row look; Remove is the kit button", () => {
  const upi = read(UPI_RULES);
  assert.ok(upi.includes("export function UpiRulesFields("), "landmark: the UPI list is read");
  assert.ok(upi.includes("className={SETTINGS_LIST_ROW_CLASS}"), "UpiRulesFields uses the shared row class");
  assert.ok(!upi.includes("SLAB_ROW_CLASS"), "UpiRulesFields no longer keeps its own row class");
  for (const rel of [PROMO_ROW, BANNERS]) {
    const s = read(rel);
    assert.ok(s.includes("className={SETTINGS_LIST_ROW_CLASS}"), `${rel}: the row wears the list-row class`);
    // The card title is an h2 (SettingsCard), so a row title is an h3, as a SettingsBlock's is: no skipped level.
    assert.ok(s.includes("<h3 className={SETTINGS_LIST_ROW_TITLE_CLASS}>"), `${rel}: the row title is an h3 in the title class`);
    assert.ok(!/<h[4-6]\b/.test(s), `${rel}: no heading below h3 inside the card`);
    assert.ok(s.includes('className={cn(SETTINGS_REMOVE_BUTTON_CLASS, "shrink-0")}'), `${rel}: Remove is the kit remove button`);
    assert.ok(s.includes('<Trash2 className="size-4" aria-hidden="true" />'), `${rel}: Remove keeps its icon`);
  }
});

test("buttons: every Add / Remove button is type=button, so a tap never submits (saves) the settings form", () => {
  for (const rel of [PROMO_LIST, PROMO_ROW, BANNERS]) {
    const s = read(rel);
    const buttons = s.match(/<button\b/g) ?? [];
    assert.ok(buttons.length > 0, `${rel}: has its own buttons (landmark)`);
    const typed = s.match(/<button\s+type="button"/g) ?? [];
    assert.equal(typed.length, buttons.length, `${rel}: each <button> starts with type="button"`);
  }
});

test("words, ids and inputs: the promo row's own text and attributes are kept", () => {
  const s = read(PROMO_ROW);
  for (const word of [
    'label="Code"',
    'hint="3 to 16 letters or numbers"',
    "<CardField label=\"Code\" htmlFor={codeId}",
    "className={SETTINGS_INPUT_CLASS}",
    "aria-invalid={codeError !== undefined}",
    "field.onChange(e.target.value.toUpperCase())",
    "maxLength={PROMO_CODE_INPUT_MAX_LEN}",
    'placeholder="SAVE10"',
    'autoCapitalize="characters"',
    'autoComplete="off"',
    "spellCheck={false}",
    'legend="Discount type"',
    "options={EDITABLE_PROMO_KINDS}",
    'label={kind === "percent" ? "Discount (%)" : "Discount (₹)"}',
    'hint={kind === "percent" ? "1 to 100" : undefined}',
    'label="Minimum order (₹)"',
    'hint="Leave blank for no minimum"',
    "register(`promoCodes.${index}.value`, { valueAsNumber: true })",
    'max={kind === "percent" ? PERCENT_MAX : undefined}',
    "aria-invalid={valueError !== undefined}",
    "aria-invalid={minError !== undefined}",
    'value={field.value ?? ""}',
    'field.onChange(e.target.value === "" ? undefined : Number(e.target.value))',
    'type="number"',
    'inputMode="numeric"',
    "min={0}",
    'aria-label={blank ? "Remove this promo code" : `Remove promo code ${code}`}',
    '{blank ? "New promo code" : code}',
    "const codeId = `${idBase}-code`;",
    "const valueId = `${idBase}-value`;",
    "const minId = `${idBase}-min`;",
    'rowFieldMessage(errors.promoCodes, index, "code")',
    'rowFieldMessage(errors.promoCodes, index, "value")',
    'rowFieldMessage(errors.promoCodes, index, "minSubtotal")',
  ]) assert.ok(s.includes(word), `PromoCodeRow keeps ${word}`);
  assert.equal(s.split("className={SETTINGS_UNIT_BOX_CLASS}").length - 1, 2, "Discount and Minimum order sit in a unit box each");
  assert.equal(s.split("className={SETTINGS_NUMBER_CLASS}").length - 1, 2, "both number inputs wear the number class");
  assert.equal(s.split("sm:grid-cols-2 sm:items-start").length - 1, 2, "both field grids top-align their fields");
  assert.ok(s.includes("className=\"flex h-[42px] items-center text-[14.5px] text-foreground\""), "the read-only kind is a 42px text line");

  const list = read(PROMO_LIST);
  for (const word of [
    'append({ code: "", kind: "percent", value: 10, active: true })',
    "Add a promo code",
    "No promo codes yet. Add one and diners can type it when they order.",
    "You can have up to {PROMO_CODE_MAX} codes.",
    'role="alert"',
    "className={SETTINGS_ERROR_CLASS}",
    "className={SETTINGS_HINT_CLASS}",
  ]) assert.ok(list.includes(word), `PromoCodesFields keeps ${word}`);
});

test("words, ids and inputs: the announcement row and list keep their text and attributes", () => {
  const s = read(BANNERS);
  for (const word of [
    'label="Title"',
    "hint={`${titleLen}/${DINER_BANNER_TITLE_MAX_LEN}`}",
    'placeholder="Diwali special"',
    "maxLength={DINER_BANNER_TITLE_MAX_LEN}",
    'label="More details (optional)"',
    "hint={`${bodyLen}/${DINER_BANNER_BODY_MAX_LEN}`}",
    'placeholder="20% off on all desserts this week"',
    "maxLength={DINER_BANNER_BODY_MAX_LEN}",
    "{...register(`dinerBanners.${index}.title`)}",
    "{...register(`dinerBanners.${index}.body`)}",
    "className={SETTINGS_INPUT_CLASS}",
    "aria-invalid={titleError !== undefined}",
    "aria-invalid={bodyError !== undefined}",
    "{blank ? `Announcement ${index + 1}` : title}",
    'aria-label={blank ? "Remove this announcement" : `Remove announcement ${title}`}',
    'append({ title: "", body: "" })',
    "Add an announcement",
    "No announcements yet.",
    "You can show up to {DINER_BANNER_MAX} announcements.",
    "Diners see these only while Diner accounts is on in",
    'role="alert"',
    "className={SETTINGS_ERROR_CLASS}",
    "className={SETTINGS_HINT_CLASS}",
    'settingsSectionPath("loyalty")',
    "className={SETTINGS_LINK_CLASS}",
  ]) assert.ok(s.includes(word), `DinerBannersFields keeps ${word}`);
  assert.ok(s.includes('import { AppLink } from "@/components/layout/AppLink";'), "the note links through AppLink");
  assert.ok(s.includes("SETTINGS_ADD_BUTTON_CLASS"), "Add wears the kit Add button");
});

test("switch rows: Tables and the two promo toggles are SettingsSwitchRows with today's words, inside their Controller", () => {
  const self = read(SELF_ORDER);
  const tables = self.indexOf('name="allowTableChange"');
  assert.ok(tables > 0, "the allowTableChange Controller");
  const tablesRow = self.search(
    /<SettingsSwitchRow\s+label="Let diners pick their table"\s+sub="When off, they can only order a parcel\. A scanned table QR code always sets the table\."\s+checked=\{field\.value\}\s+onCheckedChange=\{field\.onChange\}/,
  );
  assert.ok(tablesRow > tables, "the Tables row renders inside the allowTableChange Controller");

  const promo = read(PROMO_ROW);
  const active = promo.indexOf("name={`promoCodes.${index}.active`}");
  const once = promo.indexOf("name={`promoCodes.${index}.oncePerCustomer`}");
  assert.ok(active > 0 && once > active, "both promo Controllers, active first");
  const activeRow = promo.search(
    /<SettingsSwitchRow\s+label="Code is on"\s+sub="Diners can use it now\. Turn it off to pause it without deleting it\."\s+checked=\{field\.value \?\? false\}\s+onCheckedChange=\{field\.onChange\}/,
  );
  const onceRow = promo.search(
    /<SettingsSwitchRow\s+label="One use per customer"\s+sub="Each mobile number can use it on one order only\."\s+checked=\{field\.value \?\? false\}\s+onCheckedChange=\{field\.onChange\}/,
  );
  assert.ok(activeRow > active && activeRow < once, "Code is on renders inside the active Controller");
  assert.ok(onceRow > once, "One use per customer renders inside the oncePerCustomer Controller");
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, native select, /NN colour opacity, old kit pieces", () => {
  for (const rel of OWNED) {
    const s = read(rel);
    assert.ok(s.length > 0 && s.includes("export"), `${rel}: read (landmark)`);
    assert.ok(!s.includes("color-mix"), `${rel}: no color-mix()`);
    assert.ok(!s.includes("light-dark("), `${rel}: no light-dark()`);
    assert.ok(!s.includes("backdrop-blur"), `${rel}: no backdrop-blur`);
    assert.ok(!s.includes("overflow-hidden"), `${rel}: overflow-clip, never overflow-hidden`);
    assert.ok(!s.includes("brand-"), `${rel}: no brand-* class`);
    assert.ok(!/<select\b/.test(s), `${rel}: the kit Select, never a native <select>`);
    const opacity = s.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/);
    assert.equal(opacity, null, `${rel}: no /NN opacity modifier on a colour (found ${opacity?.[0]})`);
    assert.ok(!s.includes("@/components/ui/button"), `${rel}: our own 42px buttons, not the stock Button`);
    for (const old of ["SettingsGroup", "ToggleRow", "PrintSizeChoice"]) {
      assert.ok(!s.includes(old), `${rel}: no ${old} (the old look)`);
    }
    assert.ok(!/\bHINT_CLASS\b/.test(s), `${rel}: SETTINGS_HINT_CLASS, not the old HINT_CLASS`);
    assert.ok(!/\bBRAND_/.test(s), `${rel}: no BRAND_* class constant`);
  }
});

test("every touched file stays within 300 lines", () => {
  const touched = [
    ...OWNED,
    "components/settings/SettingsCard.tsx",
    "lib/settings-card-layout.ts",
    "lib/settings-qr-layout.test.ts",
    "lib/qr-ordering-settings-paths.test.ts",
    "lib/settings-business-layout.test.ts",
    "lib/settings-card-layout.test.ts",
  ];
  for (const rel of touched) {
    const lines = readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length - 1;
    assert.ok(lines <= 299, `${rel} is ${lines} lines (wc -l <= 299)`);
  }
});
