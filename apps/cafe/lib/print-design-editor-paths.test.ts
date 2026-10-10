import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";
import { BILL_NO_ROW_TEXT } from "@/lib/print-design-labels";
import { BILL_EDITOR, lockReasonOf } from "@/lib/print-design-editor";
import { BILL_KIND } from "@/lib/print-design-kinds";

// Print customization S4 (04-S4-plan §5, plan Amendment A7): source pins for the Bill design editor UI and its seams.
// Same technique as print-slip-code-pins.test.ts (raw source, comments stripped where a comment could satisfy a
// pin). Every ABSENCE pin sits beside a landmark that proves the file was really read (testing.md vision guard).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(read(rel));
const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const CAFE = "apps/cafe";
const DESIGN_DIR = `${CAFE}/components/settings/print-design`;
const PAGE = `${CAFE}/app/(dashboard)/settings/bill-print/page.tsx`;
const SECTION_HOOK = `${CAFE}/hooks/use-settings-section-form.ts`;
const SAMPLE_LIB = `${CAFE}/lib/bill-print-sample.ts`;
const KOT_PAGE = `${CAFE}/app/(dashboard)/settings/kitchen-ticket/page.tsx`;
const TOKEN_PAGE = `${CAFE}/app/(dashboard)/settings/tokens/page.tsx`; // S7 Slice D: the third page that passes `extra`
const TOKEN_DRAFT_HOOK = `${CAFE}/hooks/use-token-design-draft.ts`;
const DRAFT_HOOK = `${CAFE}/hooks/use-slip-design-draft.ts`; // the generic state machine; the bill and kitchen hooks are thin wrappers
const DRAFT_HOOKS = [DRAFT_HOOK, `${CAFE}/hooks/use-bill-design-draft.ts`, `${CAFE}/hooks/use-kot-design-draft.ts`];
const EDITOR_LIB = [`${CAFE}/lib/print-design-editor.ts`, `${CAFE}/lib/print-design-editor-ops.ts`, `${CAFE}/lib/print-design-labels.ts`, `${CAFE}/lib/print-design-kinds.ts`];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !/\.fixtures\.ts$/.test(entry.name)) out.push(rel);
  }
  return out;
}
const APP_FILES = ["app", "components", "hooks", "lib"].flatMap((dir) => walk(`${CAFE}/${dir}`));
const DESIGN_FILES = walk(DESIGN_DIR);
const EDITOR_FILES = [...DESIGN_FILES, ...DRAFT_HOOKS, ...EDITOR_LIB];

function specifiersOf(src: string): { specifier: string; type: boolean }[] {
  const found: { specifier: string; type: boolean }[] = [];
  for (const m of src.matchAll(/\b(?:import|export)\s+(type\s+)?[^;"'`]*?\bfrom\s*["']([^"']+)["']/g)) found.push({ specifier: m[2], type: Boolean(m[1]) });
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) found.push({ specifier: m[1], type: false });
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push({ specifier: m[1], type: false });
  return found;
}
const importersOf = (match: (specifier: string) => boolean): string[] =>
  APP_FILES.filter((file) => specifiersOf(read(file)).some((i) => match(i.specifier))).sort();

test("landmark: the scans see the editor's files and the real receipt text lives where the needles say", () => {
  assert.ok(APP_FILES.length > 100, `scan saw ${APP_FILES.length} app files`);
  for (const name of ["BillDesignSection", "BlockEditor", "BlockOptionsSheet", "BlockRow", "ChoiceChips", "DesignGallery", "DesignThumb", "FontPicker", "QrOptionsFields", "DesignSection", "DesignCard", "KotDesignSection", "KotDesignGallery", "KotDesignThumb", "KotItemsFields"]) {
    assert.ok(DESIGN_FILES.includes(`${DESIGN_DIR}/${name}.tsx`), `${name}.tsx is in print-design/`);
  }
  for (const file of [PAGE, KOT_PAGE, SECTION_HOOK, ...EDITOR_FILES]) assert.ok(existsSync(path.join(REPO_ROOT, file)) && read(file).length > 200, `${file} exists`);
});

// ── The preview is the real renderer; the editor holds no receipt text ───────

test("PIN: DesignThumb and the page's preview render the REAL <OrderReceipt> inside <SlipPreview>; no editor file carries receipt text", () => {
  const wrapped = /<SlipPreview>\n\s+<OrderReceipt [^\n]*\/>\n\s+<\/SlipPreview>/;
  const thumb = read(`${DESIGN_DIR}/DesignThumb.tsx`);
  assert.match(thumb, wrapped, "the thumbnail wraps <OrderReceipt> in <SlipPreview>");
  assert.ok(thumb.includes('import { OrderReceipt } from "@/components/pos/OrderReceipt";'), "from the real receipt module");
  assert.match(read(`${CAFE}/components/settings/BillPrintPreview.tsx`), wrapped, "landmark: BillPrintPreview (the page's preview) is the same shape");
  assert.ok(code(PAGE).includes("<BillPrintPreview "), "the page renders BillPrintPreview, not a copy of the receipt");
  // The needles are real receipt text (they exist in OrderReceipt), built by concatenation so this scan cannot match itself.
  const needles = ["TO" + "TAL", "Bill " + "No.", "GST" + "IN:", "Sub" + "total"];
  const receipt = read(`${CAFE}/components/pos/OrderReceipt.tsx`);
  for (const needle of needles) assert.ok(receipt.includes(needle), `landmark: the real receipt contains "${needle}"`);
  assert.ok(EDITOR_FILES.length >= 13, `landmark: ${EDITOR_FILES.length} editor files scanned`);
  for (const file of [...EDITOR_FILES, PAGE]) {
    const src = read(file);
    for (const needle of needles) assert.ok(!src.includes(needle), `${file} must not hold receipt text "${needle}" (a copy would drift)`);
  }
});

test("PIN: DesignThumb is memoized, inert and hidden from assistive tech (five live receipts per keystroke is too many otherwise)", () => {
  const src = code(`${DESIGN_DIR}/DesignThumb.tsx`);
  assert.ok(src.includes("export const DesignThumb = memo(function DesignThumb("), "memo-wrapped export");
  assert.ok(src.includes('aria-hidden="true"') && /\n\s+inert\n/.test(src), "aria-hidden + inert");
  assert.ok(src.includes("pointer-events-none"), "the scaled slip takes no pointer events");
});

test("PIN: the \"today's bill\" gallery card draws NO template (the real legacy bill); every other card draws its design's start", () => {
  const thumb = code(`${DESIGN_DIR}/DesignThumb.tsx`);
  assert.ok(thumb.includes("today?: boolean;") && thumb.includes("today = false"), "an optional prop, off by default");
  assert.ok(thumb.includes("const template = today ? null : activate(BILL_EDITOR, design, settings).template;"), "today -> null, else the design's start");
  assert.ok(thumb.includes("const withTemplate: Settings = { ...settings, billTemplate: template };"), "the card's settings carry exactly that template (null = legacy)");
  assert.ok(thumb.includes('shown.template !== null && templateNeedsSlipCode(shown.template)'), "the lazy-chunk notice never applies to a card with no template");
  assert.ok(/<SlipPreview>\n\s+<OrderReceipt order=\{shown\.order\} settings=\{shown\.settings\} \/>/.test(read(`${DESIGN_DIR}/DesignThumb.tsx`)), "landmark: still the real receipt");
  const gallery = code(`${DESIGN_DIR}/DesignGallery.tsx`);
  assert.ok(gallery.includes('today={design === "classic" && active === null}'), "only Classic, and only while no design is being edited");
  assert.equal(count(gallery, "today="), 1, "one call site");
  assert.ok(gallery.includes("<DesignThumb") && gallery.includes("createdAt={createdAt}"), "landmark: the thumb call site");
});

test("PIN: BlockEditor shows no lock reason for a line another control switches (the bill number row), but the model still knows the GST lock", () => {
  const editor = code(`${DESIGN_DIR}/BlockEditor.tsx`);
  assert.ok(editor.includes("const lockOf = (type: string) => (kind.spec.forcedOn.includes(type) ? null : lockReasonOf(kind.spec, type, lockCtx));"), "forced-on types are never shown as locked");
  assert.equal(count(editor, "lockOf("), 2, "every row and the Sheet read the same lockOf (rows + editingReason)");
  assert.ok(editor.includes("const reason = lockOf(block.type);") && editor.includes("lockOf(template.blocks.find("), "landmark: both call sites");
  assert.ok(!editor.includes("lockReasonOf(kind.spec, block.type"), "no row bypasses lockOf");
  assert.deepEqual([...BILL_EDITOR.forcedOn], ["billNo"], "landmark: the forced-on line is the bill number");
  assert.equal(lockReasonOf(BILL_EDITOR, "billNo", { gst: true, fssai: false, banner: false }), "gst", "the contract still locks it on a GST bill: only the row's text is dropped");
});

test("PIN: the unreadable-design recovery buttons wrap at 360px (RECOVERY_BUTTON_CLASS) and both carry type=\"button\"", () => {
  const src = code(`${DESIGN_DIR}/DesignSection.tsx`);
  assert.ok(src.includes('const RECOVERY_BUTTON_CLASS = "h-auto min-h-11 whitespace-normal text-left";'), "tall-enough, wrapping, left-aligned");
  assert.equal(count(src, "className={RECOVERY_BUTTON_CLASS}"), 2, "both recovery buttons");
  assert.match(src, /<Button type="button" variant="outline" className=\{RECOVERY_BUTTON_CLASS\} onClick=\{\(\) => design\.recoverClassic\(legacy\(\)\)\}>/);
  assert.match(src, /<Button type="button" variant="outline" className=\{RECOVERY_BUTTON_CLASS\} onClick=\{design\.keepToday\}>/);
});

// ── BlockRow ─────────────────────────────────────────────────────────────────

test("PIN: BlockRow's switch is disabled for a locked row and shows on-or-locked; the lock reason comes from LOCK_REASON_TEXT; the bill number row has no switch", () => {
  const row = code(`${DESIGN_DIR}/BlockRow.tsx`);
  assert.equal(count(row, "<Switch"), 1, "landmark: exactly one switch");
  assert.ok(row.includes("checked={block.on || locked}"), "checked = on || locked");
  assert.ok(row.includes("disabled={locked}"), "disabled while locked");
  assert.ok(row.includes("{lockText && ("), "the reason text is shown for a locked row");
  const editor = code(`${DESIGN_DIR}/BlockEditor.tsx`);
  assert.ok(editor.includes("lockText={reason === null ? null : LOCK_REASON_TEXT[reason]}"), "the reason text is looked up in LOCK_REASON_TEXT");
  assert.ok(editor.includes("locked={reason !== null}") && editor.includes("lockReasonOf(kind.spec, type, lockCtx)"), "locked comes from the shared contract via lockReasonOf(kind.spec)");
  // The number row: no switch, and the words saying where it is controlled.
  assert.ok(row.includes("const numberRow = forcedText !== null;"), "the number row is any row given forced text");
  assert.ok(editor.includes("forcedText={kind.spec.forcedOn.includes(block.type) ? kind.forcedRowText : null}") && BILL_KIND.forcedRowText === BILL_NO_ROW_TEXT, "the editor gives it only to forced-on lines; the bill's text is BILL_NO_ROW_TEXT");
  assert.ok(row.indexOf("{!numberRow && (") !== -1 && row.indexOf("{!numberRow && (") < row.indexOf("<Switch"), "the switch sits inside {!numberRow && (");
  assert.ok(row.includes("{numberRow && <p") && row.includes("{forcedText}"), "the number row renders the kind's text instead");
  assert.equal(BILL_NO_ROW_TEXT, "Turned on and off under Bill number.");
});

test("PIN: drag AND up/down both exist; every target is 44px at every width; keyboard drag is wired", () => {
  const row = code(`${DESIGN_DIR}/BlockRow.tsx`);
  assert.ok(row.includes("useSortable({") && row.includes("GripVertical") && row.includes("setActivatorNodeRef"), "drag: useSortable + a grip activator");
  assert.ok(row.includes("`Drag to reorder ${label}`") && row.includes("`Move ${label} up`") && row.includes("`Move ${label} down`"), "grip + Move up + Move down are labelled");
  assert.match(row, /const TARGET_CLASS = "[^"]*\bh-11 w-11\b[^"]*"/, "the shared target class is h-11 w-11");
  assert.equal(count(row, "TARGET_CLASS"), 5, "one definition, used by grip, up, down and edit");
  assert.ok(row.includes('cn(TARGET_CLASS, "touch-none")'), "touch-action none sits on the grip only");
  assert.equal(count(row, "touch-none"), 1);
  for (const file of DESIGN_FILES) assert.ok(!read(file).includes("md:h-" + "9"), `${file}: the editor never shrinks its targets at md (unlike CategoryRow)`);
  assert.ok(!/\b(?:sm|md|lg):[hw]-(?:\d|10)\b/.test(row), "no responsive shrink below 44px on a BlockRow target");
  const editor = code(`${DESIGN_DIR}/BlockEditor.tsx`);
  assert.match(editor, /useSensor\(KeyboardSensor,\s*\{\s*coordinateGetter:\s*sortableKeyboardCoordinates\s*\}\)/, "keyboard drag");
  assert.match(editor, /useSensor\(PointerSensor,\s*\{\s*activationConstraint:\s*\{\s*distance:/, "pointer drag with an activation distance");
  assert.ok(editor.includes('role="status" aria-live="polite"'), "a live region announces an up/down move");
  assert.ok(editor.includes("EDITOR_HIDDEN_BLOCK_TYPES") && editor.includes("moveBlock(template, id, delta, EDITOR_HIDDEN_BLOCK_TYPES)"), "up/down step over hidden rows");
});

test("PIN: every <button> / <Button> under print-design/ carries type=\"button\" (they sit inside the settings <form>: a bare one would submit it)", () => {
  let tags = 0;
  let typed = 0;
  for (const file of DESIGN_FILES) {
    const src = code(file);
    for (const m of src.matchAll(/<(?:button|Button)\b/g)) {
      tags++;
      const head = src.slice(m.index, m.index + 160).split(/\n\s*>|>\n/)[0];
      assert.ok(head.includes('type="button"'), `${file}: a button opened at offset ${m.index} has no type="button"`);
    }
    typed += count(src, 'type="button"');
  }
  assert.ok(tags >= 12, `landmark: ${tags} buttons found`);
  assert.equal(typed, tags, "as many type=\"button\" as buttons (no stray extra one standing in)");
  assert.equal(count(code(`${DESIGN_DIR}/BlockRow.tsx`), "<button"), 4, "landmark: BlockRow has its four native buttons");
  assert.ok(!DESIGN_FILES.some((file) => /<form\b|type="submit"/.test(code(file))), "and the editor opens no <form> and has no submit button");
});

// ── The page: watched == edited, one save path ───────────────────────────────

test("PIN: the page previews what it edits and hands the form the draft's `extra`; the legacy layout card and text size hide while a design is active", () => {
  const page = code(PAGE);
  assert.match(page, /<SettingsSectionForm settings=\{settings\} section=\{section\} extra=\{design\.extra\}>/, "extra={design.extra} on the ONE form");
  assert.match(page, /<BillPrintPreview control=\{control\} settings=\{\{ \.\.\.settings, billTemplate: design\.draft \}\} \/>/, "the draft reaches the preview through its settings prop");
  assert.ok(page.includes("{!design.active && <BillPrintCard control={control} watch={watch} settings={settings} />}"), "the legacy toggles card only while no design is active");
  assert.ok(page.includes("<BillPaperFields control={control} showTextSize={!design.active} />"), "the legacy text size hides while a design carries its own");
  assert.ok(page.includes("<BillDesignSection design={design} settings={settings} getValues={getValues} />") && page.includes("useBillDesignDraft(settings)"), "the editor and its draft hook");
  assert.equal(count(page, "<SettingsSectionForm"), 1, "one form, one Save bar");
  assert.ok(code(`${CAFE}/components/settings/BillPaperFields.tsx`).includes("showTextSize = true") && code(`${CAFE}/components/settings/BillPaperFields.tsx`).includes("{showTextSize && ("), "BillPaperFields: the size is shown by default and gated by the prop");
  assert.ok(code(`${CAFE}/components/settings/SettingsSectionForm.tsx`).includes("useSettingsSectionForm(settings, section, extra)"), "SettingsSectionForm passes extra through");
  assert.ok(page.includes("To see it on paper, save, then reprint any bill from Orders."), "the page says how to see it on paper (no sample print)");
});

test("PIN: the section-form hook checks extra.problem() before sending, sends extra.body() only while dirty, re-seeds after reset(values), and dirty = form OR extra", () => {
  const src = code(SECTION_HOOK);
  assert.ok(src.includes("const isDirty = formState.isDirty || (extra?.dirty ?? false);"), "isDirty");
  assert.match(src, /const discard = \(\) => \{\s*reset\(\);\s*extra\?\.discard\(\);\s*\}/, "Discard drops both parts");
  assert.ok(src.includes("useUnsavedGuard(isDirty);") && src.includes("useInAppLeaveGuard(isDirty && !isSaving, discard)"), "landmark: the guards read the combined flag");
  const problem = src.indexOf("extra.problem()");
  const send = src.indexOf("mutateAsync(");
  assert.ok(problem !== -1 && send !== -1 && problem < send, "extra.problem() is called before mutateAsync");
  assert.match(src, /if \(extra\?\.dirty\) \{\s*const problem = extra\.problem\(\);\s*if \(problem\) \{\s*toast\.error\(problem\);\s*return;\s*\}\s*\}/, "a problem toasts and returns before anything is sent or reset");
  assert.equal(count(src, "extra.body()"), 1, "body() is called in one place");
  assert.ok(src.includes("...(extra?.dirty ? extra.body() : {})"), "...and only behind an extra?.dirty guard");
  assert.ok(src.includes("...pickSectionValues(values, section),"), "landmark: the section's own values are still what is sent");
  const saved = src.indexOf("extra?.saved(");
  const resetValues = src.indexOf("reset(values)");
  assert.ok(resetValues > send && saved > resetValues, "extra?.saved( comes after reset(values), which comes after the PUT");
  assert.ok(src.includes("extra?.saved(saved);"), "it is handed the document the PUT returned");
  assert.ok(src.slice(send, saved).includes("catch") === false, "a rejected save never reaches saved() or reset()");
  assert.match(src, /extra\?: SectionFormExtra,/, "the parameter is optional");
});

test("PIN: only the Bill print, Kitchen ticket and Tokens pages pass `extra` (the other section pages keep the exact old behaviour)", () => {
  const pages = walk(`${CAFE}/app/(dashboard)/settings`).filter((f) => f.endsWith("/page.tsx"));
  const forms = pages.filter((f) => code(f).includes("<SettingsSectionForm"));
  assert.ok(forms.length >= 6, `landmark: ${forms.length} section pages use <SettingsSectionForm`);
  assert.deepEqual(forms.filter((f) => /\bextra=/.test(code(f))), [KOT_PAGE, PAGE, TOKEN_PAGE].sort());
  assert.ok(forms.includes(PAGE) && forms.includes(KOT_PAGE) && forms.includes(TOKEN_PAGE));
});

test("PIN: the draft hook sends the draft (null clears it), re-seeds from the saved document, and Discard re-seeds from the props", () => {
  const src = code(DRAFT_HOOK);
  assert.ok(src.includes("body: () => kind.bodyOf(draft),"), "body sends the draft through the kind; null clears it");
  assert.ok(code(`${CAFE}/lib/print-design-kinds.ts`).includes("bodyOf: (draft) => ({ billTemplate: draft }),"), "the bill kind's body is billTemplate: draft (null is Back to today's bill)");
  assert.ok(src.includes("saved: (doc) => setState(seed(kind, doc)),"), "after a save the draft is the server's copy");
  assert.ok(src.includes("discard: () => setState(seed(kind, settings)),"), "Discard returns to the saved design");
  assert.ok(src.includes("const dirty = draftDirty(base, draft, touched);") && src.includes("problem: () => {"), "dirty is the model's, problem() reads writeProblems");
  assert.ok(src.includes("writeProblems(kind.spec, draft)"), "the problem text comes from the WRITE gate through the model");
  assert.ok(code(`${CAFE}/lib/print-design-editor.ts`).includes("export function draftDirty<"), "landmark: the model's draftDirty");
  const sheet = code(`${DESIGN_DIR}/DesignSection.tsx`);
  for (const text of ["Start Classic from today's settings", "Keep today's bill", "Back to today's bill"]) assert.ok(JSON.stringify(BILL_KIND.copy).includes(text),`landmark: "${text}" (BILL_KIND.copy)`);
  assert.ok(sheet.includes('kind: "switch"') && sheet.includes('kind: "reset"') && sheet.includes('kind: "today"'), "switch / reset / Back to today each confirm first");
});

// ── Bundle guards ────────────────────────────────────────────────────────────

test("PIN: the only app importer of the WRITE gate is lib/print-design-editor.ts, and no POS or print file reaches the editor or the schema barrel", () => {
  const writeGate = importersOf((s) => s.endsWith("schemas/print-template.schema"));
  assert.deepEqual(writeGate, [`${CAFE}/lib/print-design-editor.ts`]);
  assert.ok(importersOf((s) => s.endsWith("schemas/print-template-read.schema")).includes(`${CAFE}/lib/print-template-resolve.ts`), "landmark: the scan does see the READ-module importer");
  const matchEditor = (s: string): boolean => /print-design-editor|print-design-labels|print-design-kinds|use-(?:bill|kot|slip)-design-draft|components\/settings\/print-design/.test(s);
  const editorImporters = importersOf(matchEditor);
  assert.ok(editorImporters.includes(`${DESIGN_DIR}/BlockEditor.tsx`) && editorImporters.includes(PAGE) && editorImporters.includes(KOT_PAGE) && editorImporters.includes(TOKEN_PAGE) && editorImporters.includes(TOKEN_DRAFT_HOOK), "landmark: the matcher finds the real importers");
  const ALLOWED = [`${CAFE}/components/settings/`, `${CAFE}/lib/print-design-`, ...DRAFT_HOOKS, TOKEN_DRAFT_HOOK, PAGE, KOT_PAGE, TOKEN_PAGE, SAMPLE_LIB];
  assert.ok(read(SAMPLE_LIB).includes("import type { KitchenPreviewChip } from \"@/lib/print-design-labels\";"), "the one lib file outside the editor that names it (the preview sample) takes a TYPE only");
  for (const file of editorImporters) assert.ok(ALLOWED.some((a) => file.startsWith(a)), `${file} imports the editor from outside the settings page`);
  const receiptSide = APP_FILES.filter((f) => f.startsWith(`${CAFE}/components/print/`) || f.startsWith(`${CAFE}/components/pos/`));
  assert.ok(receiptSide.length > 40 && receiptSide.some((f) => f.includes("/slip/SlipEngine.tsx")) && receiptSide.some((f) => f.endsWith("/OrderReceipt.tsx")), `landmark: ${receiptSide.length} receipt-side files scanned`);
  assert.deepEqual(receiptSide.filter((f) => specifiersOf(read(f)).some((i) => matchEditor(i.specifier))), [], "no receipt-side file imports the editor");
  // The schema barrel re-exports the WRITE gate (a value import of it would carry the gate into the receipt bundle).
  assert.ok(read("packages/shared/src/schemas/index.ts").includes('export * from "./print-template.schema";'), "landmark: the barrel does re-export the WRITE gate");
  const barrel = receiptSide.filter((f) => specifiersOf(read(f)).some((i) => !i.type && (i.specifier === "@pos/shared/schemas" || i.specifier === "@/schemas")));
  assert.deepEqual(barrel, [], "no receipt-side file value-imports the schema barrel");
});

// ── No "Print a sample", no automation (A7) ──────────────────────────────────

test("PIN: no \"Print a sample\" host wiring (owner Q2): the host provider, bridge and print sources do not mention a sample, and the editor adds no print call", () => {
  const host: [string, string][] = [
    [`${CAFE}/components/layout/PrintHostProvider.tsx`, "export function PrintHostProvider("],
    [`${CAFE}/hooks/use-print-host-bridge.ts`, "export function usePrintHostBridge("],
    [`${CAFE}/components/print/PrintHostPrintSources.tsx`, "export function PrintHostPrintSources("],
  ];
  for (const [file, landmark] of host) {
    const src = read(file);
    assert.ok(src.includes(landmark), `landmark: ${file} is the real file (${landmark})`);
    assert.ok(!/sample/i.test(src), `${file} must not mention a sample print`);
  }
  for (const file of [...EDITOR_FILES, PAGE]) {
    const src = read(file);
    assert.ok(!src.includes("Print a " + "sample"), `${file}: no "Print a sample" control`);
    assert.ok(!src.includes("react-to-" + "print") && !src.includes("useReactTo" + "Print"), `${file}: the editor never prints`);
  }
});

test("PIN: BillNumberingCard shows the GST hint but its switch is never disabled or set by it, and no server file sets billShowNumber (no automation, A7)", () => {
  const raw = read(`${CAFE}/components/settings/BillNumberingCard.tsx`);
  const card = stripComments(raw);
  assert.ok(raw.includes("GST bills always print their invoice number (like 2627/000123). It runs for the whole financial year."), "the hint text");
  assert.ok(card.includes("{gstHint && <p className={HINT_CLASS}>{GST_NUMBER_HINT}</p>}"), "shown while GST prints, whatever the switch says (S10: the invoice number never follows it)");
  assert.ok(card.includes('name="billShowNumber"') && card.includes("<ToggleRow") && card.includes("checked={field.value}") && card.includes("onChange={(v) => {"), "landmark: the switch is the plain form-bound ToggleRow");
  assert.ok(!/disabled/i.test(raw), "nothing in the card disables the switch");
  assert.ok(!card.includes('setValue("billShowNumber"') && !card.includes("useEffect") && !card.includes("field.onChange(true)"), "nothing in the card switches it on by itself");
  const page = code(PAGE);
  assert.ok(page.includes("const gstHint = settings.gstEnabled && settings.gstRate > 0;") && page.includes("gstHint={gstHint}"), "landmark: the page computes and passes the hint only");
  for (const file of [PAGE, DRAFT_HOOK, ...DESIGN_FILES, ...EDITOR_LIB]) {
    assert.ok(!code(file).includes('"billShowNumber"'), `${file} never writes the numbering field`);
  }
  const route = read(`${CAFE}/app/api/settings/route.ts`);
  assert.ok(route.includes("settingsUpdateOf(parsed.data)") && route.includes("export async function PUT("), "landmark: the PUT route still builds its update with settingsUpdateOf");
  const serverFiles = [...walk(`${CAFE}/app/api/settings`), `${CAFE}/lib/settings.ts`];
  assert.ok(serverFiles.length >= 2 && read(`${CAFE}/lib/settings.ts`).includes("export function settingsUpdateOf("), "landmark: lib/settings.ts is the real one");
  for (const file of serverFiles) assert.ok(!read(file).includes("billShow" + "Number"), `${file} never sets or reads the bill number switch`);
  for (const name of ["withGst" + "BillNumbering", "billNumbering" + "Forced"]) {
    assert.deepEqual(APP_FILES.filter((f) => read(f).includes(name)), [], `${name} (the dropped server flip) exists nowhere in the app`);
  }
});
