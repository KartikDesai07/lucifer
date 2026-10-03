import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Settings > Rewards & loyalty (slice 8, s70). Source pins over comment-stripped source, each
// needle narrowed to its subject; the promo status rule is runtime-tested in milestone-promo-status.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const SETTINGS = "apps/cafe/components/settings";
const PAGE = "apps/cafe/app/(dashboard)/settings/loyalty/page.tsx";
const CARD = `${SETTINGS}/LoyaltyCard.tsx`;
const GRID = `${SETTINGS}/LoyaltyStampGrid.tsx`;
const BOX = `${SETTINGS}/LoyaltyStampBox.tsx`;
const REWARD = `${SETTINGS}/MilestoneRewardFields.tsx`;
const CODE_FIELDS = `${SETTINGS}/MilestoneRewardCodeFields.tsx`;

const countOf = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

// The text from the `<Button` whose visible label is `label` up to its close.
function buttonLabelled(src: string, label: string): string {
  const seg = src.split("<Button").slice(1).find((s) => new RegExp(`${label}\\s*</Button>`).test(s));
  assert.ok(seg, `landmark: a button labelled "${label}"`);
  return seg;
}

test("PIN: the page puts LoyaltyCard then LoyaltyStampGrid in one space-y-6 column", () => {
  const src = code(PAGE);
  assert.match(
    src,
    /<div className="space-y-6">\s*<LoyaltyCard\b[^>]*\/>\s*<LoyaltyStampGrid\b[^>]*\/>\s*<\/div>/,
    "one wrapper, the card first, the rewards second",
  );
});

test("PIN: LoyaltyCard is two SettingsGroups (Diner accounts, Stamp card) and no Card", () => {
  const src = code(CARD);
  assert.match(src, /export function LoyaltyCard\(/, "landmark: the component is still here");
  assert.equal(countOf(src, /<SettingsGroup\b/g), 2, "exactly two groups");
  assert.match(src, /<SettingsGroup title="Diner accounts"/, "the first group");
  assert.match(src, /<SettingsGroup\s+title="Stamp card"/, "the second group");
  assert.ok(!/<Card[A-Z\s>]/.test(src), "no <Card…> wrapper");
  assert.ok(src.includes('label="Let diners sign in"') && src.includes('label="Turn on the stamp card"'), "switch labels");
});

test("PIN: the stamp card switch is shown off and locked while sign-in is off, and never writes the stored value", () => {
  const src = code(CARD);
  assert.match(
    src,
    /const accountsOn = useWatch\(\{ control, name: "dinerAccountsEnabled" \}\) === true;/,
    "accountsOn is the WATCHED sign-in value",
  );
  const block = /name="loyaltyEnabled"[\s\S]*?<ToggleRow[\s\S]*?\/>/.exec(src)?.[0];
  assert.ok(block, "landmark: the loyaltyEnabled ToggleRow");
  assert.ok(block.includes("disabled={!accountsOn}"), "the switch cannot be flipped while sign-in is off");
  assert.ok(block.includes("checked={accountsOn && (field.value ?? false)}"), "it shows off while sign-in is off");
  assert.ok(block.includes("onChange={field.onChange}"), "a flip while enabled is the plain field change");
  assert.ok(!/setValue/.test(src), "the file never calls setValue (the stored value is untouched)");
  assert.equal(countOf(src, /"loyaltyEnabled"/g), 1, "loyaltyEnabled appears once: its Controller, nothing writes it");
});

test("PIN: the card size and the stamp's name are registered in LoyaltyCard, not in the grid", () => {
  const card = code(CARD);
  assert.match(card, /register\("loyaltyRules\.cardSize", \{ valueAsNumber: true \}\)/, "cardSize lives in the card");
  assert.match(card, /register\("loyaltyRules\.unitLabel"\)/, "unitLabel lives in the card");
  assert.ok(card.includes('label="Stamps to fill the card"') && card.includes('label="Name for a stamp"'), "their labels");
  const grid = code(GRID);
  assert.match(grid, /export function LoyaltyStampGrid\(/, "landmark: the grid is still here");
  assert.ok(!/register\("loyaltyRules\.(cardSize|unitLabel)"/.test(grid), "the grid must not register either field");
  assert.ok(!/<Input\b/.test(grid), "the grid has no inputs of its own");
});

test("PIN: every LoyaltyCard input is a 40px control with an id its Field points at", () => {
  const src = code(CARD);
  assert.equal(countOf(src, /<Input\b/g), 3, "landmark: three inputs");
  assert.equal(countOf(src, /className=\{BRAND_CONTROL_CLASS\}/g), 3, "each is h-10");
  assert.equal(countOf(src, /htmlFor=\{\w+Id\}/g), 3, "each Field names its input");
  assert.equal(countOf(src, /inputMode="numeric"/g), 2, "the two numeric ones open a number pad");
});

test("PIN: the grid is the Rewards group, one LoyaltyStampBox per stamp, disabled only for an empty box at the cap", () => {
  const src = code(GRID);
  assert.match(src, /<SettingsGroup\s+title="Rewards"/, "the group title");
  assert.ok(!/<Card[A-Z\s>]/.test(src), "no <Card…> wrapper");
  assert.match(src, /Array\.from\(\{ length: boxes \}[\s\S]*?<LoyaltyStampBox\b/, "boxes map to LoyaltyStampBox");
  assert.ok(src.includes("disabled={atMax && !hasReward}"), "an empty box at the cap is disabled");
  assert.ok(
    src.includes("hasError={hasReward && (codeBroken || rowHasError(errors.loyaltyRules?.milestones, index))}") &&
      src.includes("const hasCode = codeStatus === \"ok\";") &&
      src.includes("const codeBroken = codeStatus === \"missing\" || codeStatus === \"off\";"),
    "a box is marked when its row has ANY error",
  );
  assert.match(src, /<p className=\{BRAND_FIELD_ERROR_CLASS\} role="alert">\s*\{arrayError\}/, "the array-root error still renders");
});

test("PIN: closePanel removes the draft row ONLY when the panel is new, then closes", () => {
  const src = code(GRID);
  const body = /const closePanel = \(\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1];
  assert.ok(body, "landmark: closePanel");
  assert.match(
    body,
    /if \(panelIsNew && openAt !== null\) \{\s*const draftIndex = rowIndexAt\(openAt\);\s*if \(draftIndex !== -1\) remove\(draftIndex\);\s*\}/,
    "the remove sits inside the panelIsNew guard, looked up by stamp number, guarded for -1",
  );
  assert.equal(countOf(body, /\bremove\(/g), 1, "no second, unguarded remove");
  assert.match(body, /\}\s*setOpenAt\(null\);\s*$/, "then it closes");
  assert.ok(!body.includes("setPanelIsNew"), "closing never flips the flag (title/footer keep their words while closing)");
});

test("PIN: every way out of the Sheet (X, Escape, outside tap) goes through closePanel; Cancel too", () => {
  const src = code(GRID);
  assert.match(
    src,
    /<Sheet\s+open=\{openAt !== null\}\s+onOpenChange=\{\(next\) => \{\s*if \(!next\) closePanel\(\);\s*\}\}/,
    "Sheet onOpenChange(false) calls closePanel",
  );
  assert.ok(/onClick=\{closePanel\}/.test(buttonLabelled(src, "Cancel")), "Cancel calls closePanel");
});

test("PIN: Add reward keeps the row; Done only closes; Remove reward only opens the confirm", () => {
  const src = code(GRID);
  const add = buttonLabelled(src, "Add reward");
  assert.ok(add.includes("onClick={() => setOpenAt(null)}"), "Add reward closes WITHOUT closePanel, which keeps the row");
  assert.ok(!/\bremove\(/.test(add), "Add reward must not remove the row");
  assert.ok(buttonLabelled(src, "Done").includes("onClick={() => setOpenAt(null)}"), "Done just closes");
  const remove = buttonLabelled(src, "Remove reward");
  assert.ok(remove.includes("setRemoveAt(openAt)") && remove.includes("setConfirmOpen(true)"), "Remove reward opens the confirm for this stamp");
  assert.ok(!/\bremove\(/.test(remove), "the Remove reward click must not remove directly");
  assert.ok(remove.includes('aria-hidden="true"') && /<Trash2\b/.test(remove), "Trash2 icon, hidden from screen readers");
});

test("PIN: the confirm removes the row it was opened for, looked up at confirm time, and names the stamp", () => {
  const src = code(GRID);
  const dialog = /<ConfirmDialog[\s\S]*?\n {10}\/>/.exec(src)?.[0];
  assert.ok(dialog, "landmark: the ConfirmDialog");
  const sheet = /<SheetContent\b[\s\S]*?<\/SheetContent>/.exec(src)?.[0] ?? "";
  assert.ok(sheet.includes(dialog), "the confirm sits INSIDE SheetContent (else its Cancel closes the panel)");
  assert.ok(dialog.includes("open={confirmOpen}"), "its own open flag");
  assert.ok(dialog.includes('title={`Remove the reward at stamp ${removeAt ?? ""}?`}'), "the title names the stamp, never null");
  assert.ok(dialog.includes('confirmLabel="Remove"'), "the confirm button says Remove");
  assert.match(
    dialog,
    /const removeIndex = removeAt === null \? -1 : rowIndexAt\(removeAt\);\s*if \(removeIndex !== -1\) remove\(removeIndex\);\s*setConfirmOpen\(false\);\s*setOpenAt\(null\);/,
    "confirm removes the row at that stamp, then closes both",
  );
  assert.ok(src.includes("const [removeAt, setRemoveAt] = useState<number | null>(null);"), "the target is its own state");
  assert.ok(src.includes("const [confirmOpen, setConfirmOpen] = useState(false);"), "the open flag is separate (no title flicker)");
});

test("PIN: the panel title reads panelAt, which is set on open and never cleared; a new panel says Add a reward", () => {
  const src = code(GRID);
  const title = /<SheetTitle>([\s\S]*?)<\/SheetTitle>/.exec(src)?.[1];
  assert.ok(title, "landmark: the SheetTitle");
  assert.ok(title.includes("panelAt") && !title.includes("openAt"), "title reads panelAt, not openAt");
  assert.ok(title.includes("`Add a reward at stamp ${panelAt}`") && title.includes("`Reward at stamp ${panelAt}`"), "both titles");
  assert.ok(!/setPanelAt\(null\)/.test(src), "panelAt is never cleared");
  assert.equal(countOf(src, /setPanelAt\(at\)/g), 1, "landmark: it is set when a box opens");
  const open = /const openBox = \(at: number\) => \{([\s\S]*?)\n {2}\};/.exec(src)?.[1] ?? "";
  assert.equal(countOf(open, /setPanelIsNew\((true|false)\)/g), 2, "openBox sets the flag both ways");
  assert.equal(countOf(src, /setPanelIsNew\(/g), 2, "and nothing else flips it (no title/footer swap while closing)");
  assert.ok(src.includes("const openIndex = openAt === null ? -1 : rowIndexAt(openAt);"), "the body index follows openAt");
  assert.ok(src.includes("{openIndex !== -1 && (") && src.includes("index={openIndex}"), "and unmounts with a remove()");
});

test("PIN: opening an empty box adds a draft only below the cap and marks the panel new", () => {
  const src = code(GRID);
  assert.match(
    src,
    /if \(rowIndexAt\(at\) === -1\) \{\s*if \(atMax\) return;\s*append\(\{ at, kind: "flat", value: 50, item: "" \}\);\s*setPanelIsNew\(true\);\s*\} else \{\s*setPanelIsNew\(false\);\s*\}/,
    "append only for a row-less box, never at the cap; an existing reward is not new",
  );
});

test("PIN: the panel footer has the save note and 44px buttons for both states", () => {
  const src = code(GRID);
  assert.ok(src.includes('const FOOTER_BUTTON_CLASS = "h-11 md:h-10";'), "44px on touch, 40px from md");
  for (const label of ["Cancel", "Add reward", "Remove reward", "Done"]) {
    assert.ok(buttonLabelled(src, label).includes("FOOTER_BUTTON_CLASS"), `${label} uses the 44px class`);
  }
  assert.ok(src.includes("<p className={HINT_CLASS}>Changes save when you press Save changes.</p>"), "the save note");
  assert.match(src, /<SheetContent className="[^"]*\boverflow-y-auto\b[^"]*\bsm:max-w-md\b[^"]*">/, "the panel scrolls and caps its width");
});

test("PIN: the grid's empty and cap lines", () => {
  const src = code(GRID);
  for (const line of ["No rewards yet. Tap a box to add one.", "rewards on the card.", "Remove one to place another.", "Set how many stamps fill the card to draw it."]) {
    assert.ok(src.includes(line), line);
  }
  assert.ok(!/<Plus\b/.test(src), "the cap line has no Plus icon");
});

test("PIN: the stamp box names its state for a screen reader and is natively disabled", () => {
  const src = code(BOX);
  assert.match(src, /export function LoyaltyStampBox\(/, "landmark: the component");
  assert.ok(src.includes('(hasCode ? ", gives a promo code" : "")'), "a promo code is read out");
  assert.ok(src.includes('(hasError ? ", needs fixing" : "")'), "an error is read out");
  assert.ok(src.includes("`Stamp ${at}: edit its reward`") && src.includes("`Stamp ${at}: add a reward`"), "edit / add");
  assert.match(src, /<button\s+type="button"\s+onClick=\{onOpen\}\s+disabled=\{disabled\}\s+aria-label=\{label\}/, "a real disabled button");
  assert.ok(src.includes('disabled && "cursor-not-allowed opacity-50"'), "a disabled box looks disabled");
  assert.ok(src.includes('hasError && "border-solid border-brand-danger"'), "an error box has a solid red border");
  assert.match(src, /<AlertCircle[^>]*aria-hidden="true"/, "the alert mark is decorative");
});

test("PIN: the reward kind is a PrintSizeChoice with plain labels, not a drop-down", () => {
  const src = code(REWARD);
  assert.match(
    src,
    /Record<LoyaltyRewardKind, string> = \{\s*flat: "Amount off",\s*percent: "Percent off",\s*item: "Free item",\s*\}/,
    "an exhaustive Record of the three labels",
  );
  assert.match(
    src,
    /name=\{`loyaltyRules\.milestones\.\$\{index\}\.kind`\}\s*render=\{\(\{ field \}\) => \{[\s\S]*?<PrintSizeChoice\s+legend="Reward"\s+options=\{LOYALTY_REWARD_KINDS\}/,
    "the choice row sits inside the kind Controller",
  );
  assert.ok(!/<SelectItem key=\{k\}/.test(src), "no kind drop-down items left");
  assert.ok(src.includes("labelOf={(k) => REWARD_KIND_LABELS[k]}"), "labels come from the Record");
});

test("PIN: leaving Free item still clears the dish inside the kind onChange", () => {
  const src = code(REWARD);
  assert.match(
    src,
    /onChange=\{\(next\) => \{\s*field\.onChange\(next\);\s*if \(next !== "item"\) \{\s*setValue\(`loyaltyRules\.milestones\.\$\{index\}\.itemProductId`, undefined, \{\s*shouldDirty: true,\s*\}\);\s*setValue\(`loyaltyRules\.milestones\.\$\{index\}\.qty`, undefined, \{ shouldDirty: true \}\);\s*setValue\(`loyaltyRules\.milestones\.\$\{index\}\.item`, "", \{ shouldDirty: true \}\);\s*\}\s*\}\}/,
    "the three clears sit inside the next !== item branch of the kind onChange",
  );
});

test("PIN: rowFieldMessage returns the bare message; the controls are 40px with ids", () => {
  const src = code(REWARD);
  const fn = /export function rowFieldMessage\([\s\S]*?\n\}/.exec(src)?.[0];
  assert.ok(fn, "landmark: rowFieldMessage");
  assert.ok(/return message;\s*\}$/.test(fn), "it returns the message itself");
  assert.ok(!/Reward \$\{/.test(src), "no 'Reward N:' prefix anywhere");
  assert.ok(src.includes("<SelectTrigger id={itemId} className={BRAND_CONTROL_CLASS}>"), "the item picker is h-10 with an id");
  assert.equal(countOf(src, /<Input\b/g), 3, "landmark: value, how many, minimum bill");
  assert.equal(countOf(src, /className=\{BRAND_CONTROL_CLASS\}/g), 4, "all three inputs and the picker are h-10");
  assert.equal(countOf(src, /inputMode="numeric"/g), 3, "each number input opens a number pad");
  assert.equal(countOf(src, /htmlFor=\{\w+Id\}/g), 4, "each Field names its control");
});

test("PIN: the promo code is a Select over the promo list; No code stores undefined; no text input", () => {
  const src = code(CODE_FIELDS);
  const block = /name=\{`loyaltyRules\.milestones\.\$\{index\}\.promoCode`\}\s*render=\{[\s\S]*?\n {8}\/>/.exec(src)?.[0];
  assert.ok(block, "landmark: the promoCode Controller");
  assert.ok(!/<Input\b/.test(block), "no text input bound to promoCode");
  assert.ok(/<Select\b/.test(block), "a Select instead");
  assert.ok(block.includes("value={field.value ? normalizePromoCode(field.value) : NO_PROMO_CODE_VALUE}"), "the shown value");
  assert.ok(block.includes("field.onChange(next === NO_PROMO_CODE_VALUE ? undefined : next)"), "No code is undefined, never an empty string");
  assert.ok(block.includes("<SelectItem value={NO_PROMO_CODE_VALUE}>No code</SelectItem>"), "the No code item");
  assert.ok(block.includes("disabled={c.active === false}"), "a switched-off code cannot be picked");
  assert.ok(block.includes('{c.code + (c.active === false ? " (switched off)" : "")}'), "and says it is off");
  assert.match(block, /\{status === "missing" && \(\s*<SelectItem value=\{current\} disabled>\s*\{`\$\{current\} \(not in your list\)`\}/, "a saved code that left the list still shows");
  assert.equal(countOf(src, /<Input\b/g), 1, "the only input left is Claim within");
  assert.ok(/<Input\s+id=\{claimId\}/.test(src), "and it is that one");
  assert.ok(/const promoCodes = useWatch\(\{ control, name: "promoCodes" \}\);/.test(src), "reads the saved promo list");
});

test("PIN: the status comes from milestonePromoStatus, and each case has its own message", () => {
  const src = code(CODE_FIELDS);
  assert.ok(src.includes("const status = milestonePromoStatus(promoCode, promoCodes);"), "one shared rule, not a local copy");
  assert.match(
    src,
    /status === "missing" && \(\s*<p className=\{BRAND_FIELD_ERROR_CLASS\}>\s*\{`\$\{current\} isn't in your promo list, so diners get no code\. Pick another or add it under `\}\s*<SectionLink slug="qr-ordering">QR ordering<\/SectionLink>\./,
    "missing: an error line with the QR ordering link",
  );
  assert.match(
    src,
    /status === "off" && \(\s*<p className=\{BRAND_FIELD_ERROR_CLASS\}>\s*\{`\$\{current\} is switched off in your promo list, so diners get no code\. Switch it on under `\}\s*<SectionLink slug="qr-ordering">QR ordering<\/SectionLink>\./,
    "off: an error line with the QR ordering link",
  );
  assert.match(
    src,
    /listable\.length === 0 && \(\s*<p className=\{HINT_CLASS\}>\s*You have no promo codes yet\. Add one under <SectionLink slug="qr-ordering">QR ordering<\/SectionLink>/,
    "no codes yet: a hint with the link",
  );
  assert.match(
    src,
    /listable\.length > 0 && \(\s*<p className=\{HINT_CLASS\}>Optional\. A diner who claims this reward also gets this code to use once\.<\/p>/,
    "otherwise the plain hint",
  );
  assert.equal(countOf(src, /!promoError &&/g), 4, "a zod error takes precedence over all four lines");
});

test("PIN: the false 'Created now' promise is gone, and SectionLink can point at QR ordering", () => {
  const src = code(CODE_FIELDS);
  assert.match(src, /export function MilestoneRewardCodeFields\(/, "landmark: the component");
  assert.ok(!/Created now/i.test(readFileSync(path.join(REPO_ROOT, CODE_FIELDS), "utf8")), "no 'Created now' even in a comment");
  assert.ok(src.includes('hint="How long after reaching this box a diner can still claim it. Leave blank for no deadline."'), "the claim hint");
  assert.match(
    code(`${SETTINGS}/SettingsFields.tsx`),
    /slug: "business" \| "taxes" \| "loyalty" \| "qr-ordering";/,
    "SectionLink accepts the qr-ordering section",
  );
});
