import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PROMO_KINDS, SELF_ORDER_MODES } from "@pos/shared/public";
import { stripComments } from "@/lib/source-pin-utils";

// Settings > QR ordering (settings pass slice 7, s69): the mode is radio tiles
// not a drop-down, the dead "show past orders" switch is hidden (its value
// still saved), the promo Type offers only what the editor can save, and a
// row that has something typed asks before it is removed. Source-read pins,
// the same technique as kitchen-ticket-preview-paths.test.ts: each needle is
// narrowed to its own subject, over comment-stripped source.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const code = (rel: string): string => stripComments(readSrc(rel));

const SETTINGS = "apps/cafe/components/settings";
const SELF_ORDER = `${SETTINGS}/SelfOrderCard.tsx`;
const PROMO_ROW = `${SETTINGS}/PromoCodeRow.tsx`;
const PROMO_LIST = `${SETTINGS}/PromoCodesFields.tsx`;
const BANNERS = `${SETTINGS}/DinerBannersFields.tsx`;
const PAGE = "apps/cafe/app/(dashboard)/settings/qr-ordering/page.tsx";
const SECTIONS = "apps/cafe/lib/settings-sections.ts";

const countOf = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

// ── SelfOrderCard ───────────────────────────────────────────────────────────

test("PIN: the self-order mode is radio tiles, with no drop-down", () => {
  const src = code(SELF_ORDER);
  assert.match(src, /export function SelfOrderCard\(/, "landmark: the stripped source still has the component");
  assert.match(src, /name="selfOrderMode"/, "landmark: the card still edits selfOrderMode");
  assert.match(src, /type="radio"/, "the modes must render native radios");
  assert.match(src, /SELF_ORDER_MODES\.map\(/, "one tile per mode, from the shared list");
  assert.ok(!/<Select/.test(src), "no <Select... drop-down in the card");
  assert.ok(!/@\/components\/ui\/select/.test(src), "no import of the stock select");
});

test("PIN: the mode copy is an EXHAUSTIVE Record over the mode union", () => {
  const src = code(SELF_ORDER);
  assert.match(
    src,
    /Record<\(typeof SELF_ORDER_MODES\)\[number\],\s*\{\s*label: string;\s*description: string\s*\}>/,
    "a Record keyed on the union, so a fourth mode fails tsc here",
  );
  assert.equal(SELF_ORDER_MODES.length, 3, "landmark: three modes today (approve, auto, menu)");
});

test("PIN: Straight to the kitchen says what happens when auto-accept fails", () => {
  const src = code(SELF_ORDER);
  assert.ok(
    src.includes("the same as an order taken at the counter. If that fails, it waits in Order Requests."),
    "the auto copy must say a failed accept waits in Order Requests",
  );
});

test("PIN: the Recommended badge is read out after the label, with a space, via its own id", () => {
  const src = code(SELF_ORDER);
  assert.match(src, /<span id=\{labelId\} className="[^"]*">\{copy\.label\}<\/span>/, "the label id sits on the label text only");
  assert.match(src, /<span\s+id=\{badgeId\}[^>]*>\s*Recommended\s*<\/span>/, "the badge has its own id");
  assert.match(
    src,
    /aria-labelledby=\{recommended \? `\$\{labelId\} \$\{badgeId\}` : labelId\}/,
    "the recommended tile is named by label + badge; the others by the label alone",
  );
});

test("PIN: the Tables group still edits allowTableChange through a ToggleRow", () => {
  const src = code(SELF_ORDER);
  assert.match(src, /name="allowTableChange"[\s\S]*<ToggleRow\b/, "allowTableChange must be a ToggleRow");
  assert.equal(countOf(src, /<SettingsGroup\b/g), 2, "two groups: Ordering and Tables");
});

test("PIN: the dead showPastOrdersToDiner switch is hidden but its field is still saved", () => {
  const src = code(SELF_ORDER);
  assert.ok(src.includes("allowTableChange"), "landmark: the strip kept real code");
  assert.ok(!src.includes("showPastOrdersToDiner"), "the card must not render or watch showPastOrdersToDiner");
  const sections = code(SECTIONS);
  const start = sections.indexOf('slug: "qr-ordering"');
  assert.ok(start >= 0, "landmark: the qr-ordering section exists");
  const fields = sections.slice(start).match(/fields:\s*\[([^\]]*)\]/);
  assert.ok(fields, "landmark: the section lists its fields");
  assert.match(
    fields[1],
    /"showPastOrdersToDiner"/,
    "hidden is not dropped: the section must still send the saved value back unchanged",
  );
});

// ── PromoCodeRow ────────────────────────────────────────────────────────────

test("PIN: the promo Type offers only the kinds this editor can save, never item", () => {
  const src = code(PROMO_ROW);
  const m = src.match(/const EDITABLE_PROMO_KINDS = \[([^\]]*)\] as const;/);
  assert.ok(m, "the row must declare EDITABLE_PROMO_KINDS as a const tuple");
  const kinds = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  assert.deepEqual(kinds, ["percent", "flat"], "percent and flat only");
  assert.ok(!kinds.includes("item"), "item needs a free dish this editor cannot set");
  assert.ok(PROMO_KINDS.includes("item"), "landmark: the shared list does have item, so leaving it out means something");
  for (const k of kinds) assert.ok((PROMO_KINDS as readonly string[]).includes(k), `${k} must be a real promo kind`);
  const fn = src.match(/function isEditableKind\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(fn, "the row must decide editability in isEditableKind");
  assert.ok(fn[1].includes("EDITABLE_PROMO_KINDS"), "editability must be membership in EDITABLE_PROMO_KINDS");
  assert.match(src, /options=\{EDITABLE_PROMO_KINDS\}/, "the Type choice must offer exactly EDITABLE_PROMO_KINDS");
  assert.ok(!/promoKindOptions/.test(src), "a stored kind must not be appended to the options");
  assert.ok(!/\bPROMO_KINDS\b/.test(src), "the row must not offer the full shared PROMO_KINDS list");
});

test("PIN: every promo kind has its own plain-English name (Record over PromoKind)", () => {
  const src = code(PROMO_ROW);
  assert.match(src, /const PROMO_KIND_LABELS: Record<PromoKind, string>/, "an exhaustive Record, not a ternary");
  assert.match(src, /labelOf=\{\(option\) => PROMO_KIND_LABELS\[option\]\}/, "the choice must label through the Record");
});

test("PIN: a stored item code is shown read-only: no Type choice, no Value box, Minimum order stays", () => {
  const src = code(PROMO_ROW);
  assert.match(src, /const kindEditable = isEditableKind\(kind\);/, "the row must derive kindEditable from the row's kind");
  const choice = src.match(/\{kindEditable \? \(([\s\S]*?)\) : \(([\s\S]*?)\)\}/);
  assert.ok(choice, "the Type cell must branch on kindEditable");
  assert.match(choice[1], /<PrintSizeChoice\b/, "the editable branch holds the choice");
  assert.ok(!/<PrintSizeChoice\b/.test(choice[2]), "the read-only branch must not hold the choice");
  assert.match(choice[2], /<Field label="Discount type" hint="Set up outside this page, so it can't be changed here\.">/, "read-only Field with its hint");
  assert.match(choice[2], /PROMO_KIND_LABELS\[kind\]/, "the read-only branch shows the kind's true name");
  assert.match(
    src,
    /\{kindEditable && \(\s*<Field\s+label=\{kind === "percent" \? "Discount \(%\)" : "Discount \(₹\)"\}/,
    "the Value field must be hidden for a non-editable kind",
  );
  const minAt = src.indexOf("promoCodes.${index}.minSubtotal");
  const valueAt = src.indexOf("{kindEditable && (");
  assert.ok(minAt > valueAt && valueAt > 0, "landmark: Minimum order follows the gated Value field");
  assert.match(src.slice(valueAt, minAt), /<\/Field>\s*\)\}/, "the Value gate must close before Minimum order, which stays for every kind");
});

test("PIN: the promo row uses PrintSizeChoice and two ToggleRows — no drop-down, no raw switch", () => {
  const src = code(PROMO_ROW);
  assert.match(src, /export function PromoCodeRow\(/, "landmark: the stripped source still has the row");
  assert.match(src, /<PrintSizeChoice<PromoKind>\s+legend="Discount type"/, "Type must be <PrintSizeChoice legend=...");
  assert.equal(countOf(src, /<ToggleRow\b/g), 2, "Code is on + One use per customer");
  assert.match(src, /name=\{`promoCodes\.\$\{index\}\.active`\}[\s\S]*<ToggleRow\b/, "active must be a ToggleRow");
  assert.match(src, /name=\{`promoCodes\.\$\{index\}\.oncePerCustomer`\}[\s\S]*<ToggleRow\b/, "oncePerCustomer must be a ToggleRow");
  assert.ok(!/<Switch\b/.test(src), "no raw <Switch in the row");
  assert.ok(!/<Select/.test(src), "no <Select... in the row");
  assert.ok(!/@\/components\/ui\/select/.test(src), "no import of the stock select");
});

test("PIN: the promo Remove button says Remove and is not an icon-only button", () => {
  const src = code(PROMO_ROW);
  assert.match(src, /<Trash2\b[^>]*\/>\s*Remove\s*<\/Button>/, "the button's visible text must be Remove");
  assert.ok(!/size="icon"/.test(src), "no size=\"icon\" Remove button");
  assert.match(src, /onClick=\{\(\) => onRemove\(code\)\}/, "the row must hand its typed code to onRemove");
});

// ── the two lists ───────────────────────────────────────────────────────────

// `blank` is the exact expression that lets a row go without a confirm: a promo
// row is blank when its code is; an announcement only when title AND details are.
const LISTS = [
  { rel: PROMO_LIST, name: "PromoCodesFields", rowCall: "(code) => requestRemove(index, code)", blank: String.raw`code\.trim\(\) === ""`, label: "code" },
  {
    rel: BANNERS,
    name: "DinerBannersFields",
    rowCall: "(title, body) => requestRemove(index, title, body)",
    blank: String.raw`title\.trim\(\) === "" && body\.trim\(\) === ""`,
    label: "title\\.trim\\(\\)",
  },
];

for (const list of LISTS) {
  test(`PIN: ${list.name} removes a blank row at once and asks before removing one with text`, () => {
    const src = code(list.rel);
    assert.match(src, new RegExp(String.raw`export function ${list.name}\(`), "landmark: the stripped source still has the list");
    assert.match(src, /<ConfirmDialog\b/, "the list must render a ConfirmDialog");
    // The blank check comes first and removes at once; only then is a row parked and the dialog opened.
    assert.match(
      src,
      new RegExp(
        String.raw`if \(${list.blank}\) \{\s*remove\(index\);\s*return;\s*\}\s*setTarget\(\{ index, label: ${list.label}[^}]*\}\);\s*setConfirmOpen\(true\);`,
      ),
      "a blank row is removed at once; a typed one parks its target and opens the dialog",
    );
    assert.ok(src.includes(`onRemove={${list.rowCall}}`), "every row must remove through requestRemove with everything it has typed");
    // Open flag and target are separate: the title keeps its text through the close animation.
    assert.match(src, /open=\{confirmOpen\}/, "the dialog's open state is its own flag");
    assert.match(src, /onOpenChange=\{setConfirmOpen\}/, "closing the dialog flips only the flag, never clears the target");
    assert.match(
      src,
      /onConfirm=\{\(\) => \{[^}]*\bif \(target\) remove\(target\.index\);[^}]*setConfirmOpen\(false\);/,
      "confirming must remove the parked row and close the dialog",
    );
    assert.ok(!/setTarget\(null\)/.test(src), "the target must outlive the close animation");
    assert.ok(!/\bremoving\b/.test(src), "landmark: the old removing state is gone");
    assert.ok(
      src.includes("This removes it from the list. Nothing changes for diners until you save."),
      "the dialog must say what a removal does before Save",
    );
    assert.ok(!src.includes("Discard brings it back"), "an unsaved row is not brought back by Discard");
  });

  test(`PIN: ${list.name} is a SettingsGroup with a dashed empty state and a 44px Add button`, () => {
    const src = code(list.rel);
    assert.match(src, /<SettingsGroup\b/, "the list must render a SettingsGroup");
    assert.ok(!/size="sm"/.test(src), "no size=\"sm\" button (32px) in the list");
    assert.match(src, /border-dashed border-brand-rule/, "an empty list shows the dashed empty state");
    assert.match(src, /variant="outline"\s+className="h-11 md:h-10"/, "the Add button must be h-11 md:h-10");
    assert.match(src, /disabled=\{atMax\}/, "Add is disabled at the maximum");
  });
}

test("PIN: an announcement with details but no title still asks first, and the dialog names it sensibly", () => {
  const src = code(BANNERS);
  assert.match(src, /onClick=\{\(\) => onRemove\(title, body\)\}/, "the row must hand both title and details to onRemove");
  assert.match(
    src,
    /title=\{target\?\.label \? `Remove "\$\{target\.label\}"\?` : "Remove this announcement\?"\}/,
    "the dialog title names the announcement, or says this announcement when there is no title",
  );
});

test("PIN: Announcements says Home tab and warns while Diner accounts is off, linking to Rewards & loyalty", () => {
  const src = code(BANNERS);
  assert.match(src, /Short lines diners see on the Home tab of the QR menu/, "the description must say Home tab");
  assert.match(src, /dinerAccountsOn: boolean;/, "the list takes the saved flag as a prop");
  assert.match(
    src,
    /\{!dinerAccountsOn && \(\s*<p className=\{HINT_CLASS\}>[^]*?<SectionLink slug="loyalty">Rewards &amp; loyalty<\/SectionLink>[^]*?<\/p>\s*\)\}/,
    "the note and its loyalty link must render only while dinerAccountsOn is false",
  );
  assert.ok(src.includes("Diners see these only while Diner accounts is on in"), "the note's wording");
  assert.match(code(`${SETTINGS}/SettingsFields.tsx`), /slug: "business" \| "taxes" \| "loyalty" \| "qr-ordering";/, "SectionLink must accept the loyalty section");
});

test("PIN: the announcement row has a visible Remove button that hands its typed title to onRemove", () => {
  const src = code(BANNERS);
  assert.match(src, /<Trash2\b[^>]*\/>\s*Remove\s*<\/Button>/, "the button's visible text must be Remove");
  assert.ok(!/size="icon"/.test(src), "no size=\"icon\" Remove button");
  assert.match(src, /onClick=\{\(\) => onRemove\(title, body\)\}/, "the row must hand its typed title to onRemove");
});

// ── the page ────────────────────────────────────────────────────────────────

test("PIN: the page renders all three groups as siblings inside one space-y-6 column", () => {
  const src = code(PAGE);
  assert.match(src, /<div className="space-y-6">[\s\S]*<SelfOrderCard\b[\s\S]*<PromoCodesFields\b[\s\S]*<DinerBannersFields\b[\s\S]*<\/div>/, "one space-y-6 wrapper around all three, in order");
  assert.match(
    src,
    /<DinerBannersFields\s+dinerAccountsOn=\{settingsFormDefaults\(settings\)\.dinerAccountsEnabled === true\}/,
    "the page must pass the SAVED Diner accounts switch to the announcements list",
  );
  assert.match(src, /import \{ settingsFormDefaults \} from "@\/lib\/settings-form-defaults";/, "and import the defaults helper");
  for (const name of ["SelfOrderCard", "PromoCodesFields", "DinerBannersFields"]) {
    assert.match(src, new RegExp(String.raw`import \{ ${name} \} from "@/components/settings/${name}";`), `the page must import ${name}`);
  }
});
