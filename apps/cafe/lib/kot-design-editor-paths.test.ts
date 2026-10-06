import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { KOT_NO_ROW_TEXT } from "@/lib/print-design-labels";
import { KOT_KIND } from "@/lib/print-design-kinds";

// Print customization S5 (05-S5-plan §5): source pins for the Kitchen ticket design editor's page and pieces. Same technique
// as print-design-editor-paths.test.ts (raw source, comments stripped where a comment could satisfy a pin). Every ABSENCE
// pin sits beside a landmark that proves the file was really read (testing.md vision guard).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(read(rel));
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const CAFE = "apps/cafe";
const SETTINGS = `${CAFE}/components/settings`;
const DESIGN_DIR = `${SETTINGS}/print-design`;
const PAGE = `${CAFE}/app/(dashboard)/settings/kitchen-ticket/page.tsx`;
const KOT_DRAFT = `${CAFE}/hooks/use-kot-design-draft.ts`;
const NEW_KOT_FILES = [`${DESIGN_DIR}/KotDesignSection.tsx`, `${DESIGN_DIR}/KotDesignGallery.tsx`, `${DESIGN_DIR}/KotDesignThumb.tsx`, `${DESIGN_DIR}/KotItemsFields.tsx`, `${DESIGN_DIR}/DesignCard.tsx`, `${DESIGN_DIR}/DesignSection.tsx`];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.fixtures\.ts$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const DESIGN_FILES = walk(DESIGN_DIR);
const EDITOR_FILES = [...DESIGN_FILES, KOT_DRAFT, `${CAFE}/hooks/use-slip-design-draft.ts`, `${CAFE}/lib/print-design-editor.ts`, `${CAFE}/lib/print-design-editor-ops.ts`, `${CAFE}/lib/print-design-labels.ts`, `${CAFE}/lib/print-design-kinds.ts`];

test("landmark: the new kitchen-ticket files exist and the scans see them", () => {
  for (const file of [PAGE, KOT_DRAFT, `${SETTINGS}/KotNumberingCard.tsx`, ...NEW_KOT_FILES]) assert.ok(existsSync(path.join(REPO_ROOT, file)) && read(file).length > 150, `${file} exists`);
  for (const file of NEW_KOT_FILES) assert.ok(DESIGN_FILES.includes(file), `${file} is scanned as a print-design file`);
  assert.ok(EDITOR_FILES.length >= 20, `${EDITOR_FILES.length} editor files scanned`);
});

// ── The page: watched == edited, one save path ───────────────────────────────

test("PIN: the kitchen-ticket page hands the ONE form the draft's `extra`, previews the draft, and hides the layout card / text size while a design is active", () => {
  const page = code(PAGE);
  assert.ok(page.includes("useKotDesignDraft(settings)"), "the draft hook");
  assert.match(page, /<SettingsSectionForm settings=\{settings\} section=\{section\} extra=\{design\.extra\}>/, "extra={design.extra} on the ONE form");
  assert.equal(count(page, "<SettingsSectionForm"), 1, "one form, one Save bar");
  assert.ok(page.includes("<KotDesignSection design={design} settings={settings} getValues={getValues} />"), "the editor section");
  assert.ok(page.includes("{!design.active && <KotPrintCard control={control} watch={watch} />}"), "the layout toggles card only while no design is active");
  assert.ok(page.includes("<KotNumberingCard control={control} register={register} setValue={setValue} watch={watch} errors={errors} />"), "the numbering card is rendered");
  const numbering = page.indexOf("<KotNumberingCard");
  assert.ok(!/design\.active\s*&&\s*$/.test(page.slice(Math.max(0, numbering - 40), numbering)) && !/\?\s*$/.test(page.slice(Math.max(0, numbering - 4), numbering)), "...and always: no design.active condition in front of it");
  assert.ok(page.includes("<KotPaperFields control={control} showTextSize={!design.active} />"), "the legacy text size hides while a design carries its own");
  assert.ok(page.includes("settings={{ ...settings, kotTemplate: design.draft }}"), "the draft reaches the preview through its settings prop");
  assert.ok(page.includes("<PreviewLoadNotice template={design.draft} />") && page.indexOf("<PreviewLoadNotice") < page.indexOf("<KitchenTicketPreview"), "the lazy-chunk failure notice sits above the preview");
  assert.ok(page.includes("To see it on paper, save, then press KOT on any order in Orders."), "the page says how to see it on paper (no sample print)");
  const kotPaper = code(`${SETTINGS}/KotPaperFields.tsx`);
  assert.ok(kotPaper.includes("showTextSize = true") && kotPaper.includes("{showTextSize && ("), "KotPaperFields: the size is shown by default and gated by the prop");
  assert.ok(read(`${SETTINGS}/KitchenTicketPreview.tsx`).includes("<KOTReceipt order={order} settings={live} {...slip} />"), "landmark: the preview draws the real receipt with the sample slip");
});

// ── The gallery thumbnail is the real ticket ─────────────────────────────────

test("PIN: KotDesignThumb is memoized, inert, hidden from assistive tech, and draws the REAL <KOTReceipt> inside <SlipPreview>", () => {
  const raw = read(`${DESIGN_DIR}/KotDesignThumb.tsx`);
  const src = stripComments(raw);
  assert.ok(src.includes("export const KotDesignThumb = memo(function KotDesignThumb("), "memo-wrapped export");
  assert.ok(src.includes('aria-hidden="true"') && /\n\s+inert\n/.test(src), "aria-hidden + inert");
  assert.ok(src.includes("pointer-events-none"), "the scaled slip takes no pointer events");
  assert.match(raw, /<SlipPreview>\n\s+<KOTReceipt [^\n]*\/>\n\s+<\/SlipPreview>/, "the thumbnail wraps <KOTReceipt> in <SlipPreview>");
  assert.ok(src.includes('import { KOTReceipt } from "@/components/pos/KOTReceipt";'), "from the real receipt module");
  assert.ok(src.includes("sampleKitchenOrder(createdAt)") && src.includes('sampleKitchenSlip("kot", order, printConfigOf(withTemplate).kot)'), "the picture is the sample order and the new-order slip");
});

test("PIN: the \"today's ticket\" card draws NO template (the real legacy ticket); every other card draws its design's start", () => {
  const thumb = code(`${DESIGN_DIR}/KotDesignThumb.tsx`);
  assert.ok(thumb.includes("today?: boolean;") && thumb.includes("today = false"), "an optional prop, off by default");
  assert.ok(thumb.includes("const template = today ? null : activate(KOT_EDITOR, design, settings).template;"), "today -> null, else the design's start");
  assert.ok(thumb.includes("const withTemplate: Settings = { ...settings, kotTemplate: template };"), "the card's settings carry exactly that template (null = legacy)");
  assert.ok(thumb.includes('shown.template !== null && templateNeedsSlipCode(shown.template)'), "the lazy-chunk notice never applies to a card with no template");
  const gallery = code(`${DESIGN_DIR}/KotDesignGallery.tsx`);
  assert.ok(gallery.includes('const today = design === "classic" && active === null;'), "only Classic, and only while no design is being edited");
  assert.equal(count(gallery, "today="), 1, "one call site");
  assert.ok(gallery.includes("<KotDesignThumb") && gallery.includes("<DesignCard") && gallery.includes("KOT_DESIGNS.map("), "landmark: the thumb, card and design list");
  assert.ok(gallery.includes("label={today ? copy.todayCardLabel : designLabel[design]}"), "the today card is named for what it is");
});

// ── Where "kotShowNumber" lives; no receipt text in the editor ────────────────

test("PIN: nothing in the editor writes \"kotShowNumber\": only the numbering card, the preview's watched list and the draft's legacy overlay name it", () => {
  const needle = "kotShow" + "Number";
  const mentions = [...walk(`${CAFE}/components/settings`), ...walk(`${CAFE}/hooks`)].filter((f) => code(f).includes(needle)).sort();
  assert.deepEqual(mentions, [`${SETTINGS}/KitchenTicketPreview.tsx`, `${SETTINGS}/KotNumberingCard.tsx`, KOT_DRAFT].sort());
  assert.ok(code(`${SETTINGS}/KotNumberingCard.tsx`).includes(`name="${needle}"`), "landmark: the card owns the switch");
  assert.ok(code(KOT_DRAFT).includes(`${needle}: values.${needle},`), "landmark: the draft hook only reads the form's value into the legacy overlay");
  assert.ok(code(`${SETTINGS}/KotPrintCard.tsx`).includes("export function KotSwitch(") && code(`${SETTINGS}/KotNumberingCard.tsx`).includes('import { KotSwitch } from "@/components/settings/KotPrintCard";'), "landmark: KotPrintCard was really read (it exports the switch the numbering card uses)");
  for (const file of [...DESIGN_FILES, `${CAFE}/lib/print-design-editor.ts`, `${CAFE}/lib/print-design-editor-ops.ts`, `${CAFE}/lib/print-design-kinds.ts`, `${CAFE}/lib/print-design-labels.ts`]) {
    assert.ok(!code(file).includes(needle), `${file} never names the numbering field`);
  }
  assert.equal(KOT_NO_ROW_TEXT, "Turned on and off under Ticket number.", "the ticket-number row says where it is controlled");
  assert.ok(code(`${SETTINGS}/KotNumberingCard.tsx`).includes('title="Ticket number"'), "landmark: ...and the group it names exists");
  assert.equal(KOT_KIND.forcedRowText, KOT_NO_ROW_TEXT);
});

test("PIN: no editor file holds kitchen-ticket receipt text (a copy would drift from the real renderer)", () => {
  const needles = ["KITCHEN" + " ORDER", "item" + "(s)", "Round" + " total:"];
  const receipt = read(`${CAFE}/components/pos/KOTReceipt.tsx`);
  for (const needle of needles) assert.ok(receipt.includes(needle), `landmark: the real ticket contains "${needle}"`);
  assert.ok(read(`${CAFE}/components/print/slip/kot-classic-blocks.tsx`).includes(needles[0]), "landmark: so does Classic's block renderer");
  for (const file of [...EDITOR_FILES, PAGE, `${SETTINGS}/KotNumberingCard.tsx`]) {
    const src = read(file);
    for (const needle of needles) assert.ok(!src.includes(needle), `${file} must not hold ticket text "${needle}"`);
  }
});

// ── Buttons, QR, Items option ────────────────────────────────────────────────

test("PIN: every <button> / <Button> in the new kitchen-ticket files carries type=\"button\" (they sit inside the settings <form>)", () => {
  let tags = 0, typed = 0;
  for (const file of NEW_KOT_FILES) {
    const src = code(file);
    for (const m of src.matchAll(/<(?:button|Button)\b/g)) {
      tags++;
      assert.ok(src.slice(m.index, m.index + 160).split(/\n\s*>|>\n/)[0].includes('type="button"'), `${file}: a button at offset ${m.index} has no type="button"`);
    }
    typed += count(src, 'type="button"');
  }
  assert.ok(tags >= 6, `landmark: ${tags} buttons found (DesignCard + the section's buttons)`);
  assert.equal(typed, tags, "as many type=\"button\" as buttons");
  assert.ok(!NEW_KOT_FILES.some((file) => /<form\b|type="submit"/.test(code(file))), "and none opens a <form> or submits");
});

test("PIN: QrOptionsFields hides the content chips and the UPI hint when allowUpi is false (a kitchen QR is a link); the Sheet and the add button pass the kind's choice", () => {
  const qr = code(`${DESIGN_DIR}/QrOptionsFields.tsx`);
  assert.ok(qr.includes("allowUpi = true"), "default true: the bill is unchanged");
  assert.ok(qr.includes("{allowUpi && (\n        <ChoiceChips") && qr.includes("{allowUpi && !hasUpi && ("), "both the content chips and the UPI hint sit behind allowUpi");
  // Review s79 MIN-2: the caption's example follows the kind too, so a kitchen QR is never captioned "Scan to pay".
  assert.ok(qr.includes("hint={allowUpi ? CAPTION_HINT_PAY : CAPTION_HINT_LINK}") && !qr.includes('hint="Printed under'), "the caption hint follows allowUpi");
  assert.equal(count(qr, "allowUpi"), 5, "landmark: the prop, its default, the two guards and the caption hint (no other use)");
  assert.ok(qr.includes('options.content === "link" && (') && qr.includes("Caption (optional)"), "landmark: the link field and caption are still shown");
  assert.ok(code(`${DESIGN_DIR}/BlockOptionsSheet.tsx`).includes("allowUpi={kind.allowUpiQr}"), "the Sheet passes the kind's choice");
  assert.ok(code(`${DESIGN_DIR}/BlockEditor.tsx`).includes("addRepeatable(template, type, settings, kind.allowUpiQr)"), "a new QR starts from the kind's choice");
  assert.equal(KOT_KIND.allowUpiQr, false);
});

test("PIN: the Sheet shows KotItemsFields only for a KOT items line, and nothing there ever writes modifiers / instructions", () => {
  const sheet = code(`${DESIGN_DIR}/BlockOptionsSheet.tsx`);
  assert.ok(sheet.includes('{kind.spec.kind === "kot" && block.type === "items" && ('), "only the KOT kind's items line");
  assert.equal(count(sheet, "<KotItemsFields"), 1, "one call site");
  assert.ok(sheet.includes("onPrices={(prices) => onChange(setKotItemsPrices(template, block.id, prices))}"), "its only write is setKotItemsPrices");
  assert.ok(!/setKotItems(?!Prices)/.test(sheet), "no other items writer is imported");
  const fields = code(`${DESIGN_DIR}/KotItemsFields.tsx`);
  assert.ok(fields.includes("onPrices") && fields.includes("KOT_ITEMS_PRICES_LABEL") && count(fields, "<ToggleRow") === 1, "landmark: one Show prices switch");
  for (const word of ["modifiers", "instructions"]) {
    assert.ok(!fields.includes(word), `KotItemsFields never mentions ${word}`);
    const ops = code(`${CAFE}/lib/print-design-editor-ops.ts`);
    const from = ops.indexOf("export function setKotItemsPrices");
    const body = ops.slice(from, ops.indexOf("\n}\n", from));
    assert.ok(from > 0 && body.includes("prices") && !body.includes(word), `setKotItemsPrices never writes ${word}`);
  }
});
