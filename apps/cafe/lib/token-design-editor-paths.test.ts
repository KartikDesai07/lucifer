import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { REPEATABLE_BLOCK_TYPES, TOKEN_BLOCK_TYPES, TOKEN_DESIGNS, TOKEN_LOCKS, isRepeatableBlockType, type TokenTemplate } from "@pos/shared/print-template";
import { updateSettingsSchema } from "@pos/shared/schemas/settings.schema";
import { stripComments } from "@/lib/source-pin-utils";
import { BILL_KIND, KOT_KIND, TOKEN_KIND } from "@/lib/print-design-kinds";
import { TOKEN_EDITOR, activate, addRepeatable, lockContextOf, lockReasonOf } from "@/lib/print-design-editor";
import { LOCK_REASON_TEXT, TOKEN_BLOCK_LABEL } from "@/lib/print-design-labels";
import { TOKEN_DEFAULT_DESIGN, defaultTokenTemplate } from "@/lib/print-template-designs";
import { sampleTokenOrder } from "@/lib/bill-print-sample";
import { settingsOf } from "@/lib/print-template-golden.fixtures";

// Print customization S7 Slice D: the Tokens page's design editor. Source pins over COMMENT-STRIPPED files (each
// absence pin sits beside a landmark that proves the file was read), and the editor model driven through its real
// exports. The WRITE-gate / editor-importer pins live in print-design-editor-paths.test.ts.

const CAFE = path.join(__dirname, "..");
const raw = (rel: string): string => readFileSync(path.join(CAFE, rel), "utf8").replace(/\r\n/g, "\n");
const code = (rel: string): string => stripComments(raw(rel));
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const PAGE = "app/(dashboard)/settings/tokens/page.tsx";
const DRAFT = "hooks/use-token-design-draft.ts";
const SECTION = "components/settings/print-design/TokenDesignSection.tsx";
const GALLERY = "components/settings/print-design/TokenDesignGallery.tsx";
const PREVIEW = "components/settings/TokenSlipPreview.tsx";
const FIELDS = "components/settings/TokenSettingsFields.tsx";
const GENERIC = ["components/settings/print-design/DesignSection.tsx", "hooks/use-slip-design-draft.ts"];
const TOKEN_FILES = [PAGE, DRAFT, SECTION, GALLERY, PREVIEW, FIELDS];

test("page: ONE form given the draft's extra, the settings fields, the design section, and a preview of the draft", () => {
  const page = code(PAGE);
  assert.equal(count(page, "<SettingsSectionForm"), 1, "one form, one Save bar");
  assert.ok(page.includes("const design = useTokenDesignDraft(settings);"), "the draft lives above the form");
  assert.ok(page.includes("<SettingsSectionForm settings={settings} section={section} extra={design.extra}>"), "extra={design.extra}");
  const fields = page.indexOf("<TokenSettingsFields control={control} register={register} setValue={setValue} errors={errors} />");
  const section = page.indexOf("<TokenDesignSection design={design} settings={settings} control={control} />");
  assert.ok(page.indexOf("<SettingsSectionForm") < fields && fields !== -1 && fields < section, "the settings fields, then the design section, inside the form");
  assert.ok(page.includes("<TokenSlipPreview control={control} settings={{ ...settings, tokenTemplate: design.draft }} />"), "the preview gets the draft through its settings");
  assert.ok(page.includes("<PreviewLoadNotice template={design.draft} needsCode={tokenTemplateNeedsSlipCode} />"), "the load notice uses the token-specific check (only a QR line waits)");
  assert.ok(page.includes('<SettingsSectionPage slug="tokens" wide>'), "landmark: the section page");
  assert.ok(raw(DRAFT).includes("useSlipDesignDraft(TOKEN_KIND, settings)"), "the draft hook is the generic machine over the token kind");
});

test("TOKEN_KIND: bodyOf sends the draft (null clears it), no pay QR, today's design is Big Number; bill and kitchen ticket stay Classic", () => {
  const draft = defaultTokenTemplate("numberItems");
  assert.deepEqual(TOKEN_KIND.bodyOf(draft), { tokenTemplate: draft });
  assert.deepEqual(TOKEN_KIND.bodyOf(null), { tokenTemplate: null }, "null is what removes the stored design");
  assert.equal(TOKEN_KIND.allowUpiQr, false, "a token has no amount to pay");
  assert.equal(BILL_KIND.allowUpiQr, true, "landmark: the bill does");
  assert.equal(TOKEN_KIND.todayDesign, "bigNumber");
  assert.equal(TOKEN_KIND.todayDesign, TOKEN_DEFAULT_DESIGN, "the editor's 'today' is the renderer's default");
  assert.equal(BILL_KIND.todayDesign, "classic");
  assert.equal(KOT_KIND.todayDesign, "classic");
  assert.equal(TOKEN_KIND.spec, TOKEN_EDITOR);
  assert.equal(TOKEN_KIND.withDraft(settingsOf(), draft).tokenTemplate, draft, "the preview's settings carry the draft under tokenTemplate");
  assert.equal(TOKEN_KIND.withDraft(settingsOf({ tokenTemplate: draft }), null).tokenTemplate, null);
  // The body must be something the Settings PUT accepts (and the section form sends it alongside the form's fields).
  assert.ok(updateSettingsSchema.safeParse(TOKEN_KIND.bodyOf(draft)).success, "a design body passes the update schema");
  assert.ok(updateSettingsSchema.safeParse(TOKEN_KIND.bodyOf(null)).success, "so does null");
  assert.ok(!("tokenTemplate" in settingsOf()), "landmark: the sample settings carry no token design");
});

test("the number's row is locked ON with 'Always printed'; no other token line is locked, in any lock context", () => {
  assert.equal(LOCK_REASON_TEXT.always, "Always printed");
  assert.deepEqual([...TOKEN_LOCKS.always], ["tokenNo"], "landmark: the contract's one lock");
  const contexts = [lockContextOf(settingsOf()), lockContextOf(settingsOf({ gstEnabled: true, gstRate: 5 })), { gst: true, fssai: true, banner: true }];
  for (const ctx of contexts) {
    assert.equal(lockReasonOf(TOKEN_EDITOR, "tokenNo", ctx), "always");
    for (const type of TOKEN_BLOCK_TYPES.filter((t) => t !== "tokenNo")) assert.equal(lockReasonOf(TOKEN_EDITOR, type, ctx), null, `${type} is free`);
  }
  assert.deepEqual([...TOKEN_EDITOR.hidden], [], "no token line is hidden from the editor (the kitchen ticket hides its station)");
  assert.deepEqual([...TOKEN_EDITOR.forcedOn], [], "and none is switched by another control");
  for (const design of TOKEN_DESIGNS) {
    const started = activate(TOKEN_EDITOR, design, settingsOf());
    assert.equal(started.template.blocks.find((b) => b.type === "tokenNo")?.on, true, `${design}: the number starts on`);
    assert.deepEqual(started.turnedOn, [], `${design}: nothing had to be switched on`);
  }
});

test("'Add a line' offers exactly the repeatable lines, and every non-repeatable token line has one row in each default", () => {
  const editor = raw("components/settings/print-design/BlockEditor.tsx");
  const offered = [...editor.matchAll(/\{ type: "(\w+)", label: "Add [^"]+" \}/g)].map((m) => m[1]).sort();
  assert.deepEqual(offered, [...REPEATABLE_BLOCK_TYPES].sort(), "landmark + pin: the three Add buttons are the repeatable types");
  for (const type of offered) assert.ok((TOKEN_BLOCK_TYPES as readonly string[]).includes(type), `${type} is a token line`);
  for (const design of TOKEN_DESIGNS) {
    const types = defaultTokenTemplate(design).blocks.map((b) => b.type);
    for (const type of TOKEN_BLOCK_TYPES.filter((t) => !isRepeatableBlockType(t))) {
      assert.equal(types.filter((t) => t === type).length, 1, `${design}: one ${type} row`);
      assert.ok(TOKEN_BLOCK_LABEL[type], `${type} has a plain-English label`);
    }
    assert.ok(types.every((t) => (TOKEN_BLOCK_TYPES as readonly string[]).includes(t)), `${design}: no row outside the catalog`);
  }
  // A new QR starts as an empty LINK even when the cafe has a valid UPI id: a token has no amount to pay.
  const settings = settingsOf({ upiId: "samplecafe@okaxis" });
  const base = defaultTokenTemplate("bigNumber");
  const qrOf = (allowUpi: boolean): unknown => (addRepeatable(base, "qr", settings, allowUpi).template.blocks.at(-1) as { options?: unknown } | undefined)?.options;
  assert.deepEqual(qrOf(TOKEN_KIND.allowUpiQr), { content: "link", url: "" });
  assert.deepEqual(qrOf(BILL_KIND.allowUpiQr), { content: "upi" }, "landmark: the bill's kind does offer the pay QR from the same settings");
  assert.equal(raw("components/settings/print-design/BlockEditor.tsx").includes("addRepeatable(template, type, settings, kind.allowUpiQr)"), true, "the editor passes the kind's flag");
});

test("the gallery draws the REAL TokenSlip (eager, scale 0.4) and never a <SlipPreview>; the preview is the real slip too", () => {
  const gallery = raw(GALLERY);
  assert.ok(gallery.includes("<TokenSlip order={shown.order} settings={shown.settings} />") && gallery.includes('import { TokenSlip } from "@/components/print/slip/TokenSlip";'), "landmark: the thumbnail is TokenSlip");
  assert.ok(gallery.includes('const THUMB_SCALE_CLASS = "scale-[0.4]";') && /aria-hidden="true"\n\s+inert/.test(gallery), "scaled 0.4, inert and hidden from assistive tech");
  assert.ok(!/<SlipPreview|import \{ SlipPreview/.test(gallery),"no SlipPreview wrapper (nothing lazy to wait for) - and the import is gone too");
  assert.ok(!gallery.includes("OrderReceipt") && !gallery.includes("KOTReceipt"), "no bill or ticket thumbnail either");
  assert.ok(gallery.includes("const template = today ? null : activate(TOKEN_EDITOR, design, settings).template;"), "the 'standard' card draws NO template: the real default");
  const preview = raw(PREVIEW);
  assert.ok(preview.includes("<TokenSlip order={sampleTokenOrder(createdAt, live)} settings={live} />") && !/<SlipPreview|import \{ SlipPreview/.test(preview),"the preview: TokenSlip, not wrapped in SlipPreview");
  assert.ok(raw(SECTION).includes("gallery={(args) => <TokenDesignGallery settings={settings} {...args} />}") && raw(SECTION).includes("kind={TOKEN_KIND}"));
});

test("sampleTokenOrder: the number is the start number the next order would get; the bill number follows Show bill number", () => {
  const at = "2026-10-05T10:00:00.000Z";
  assert.equal(sampleTokenOrder(at, settingsOf({ tokenNumberStart: 101 })).tokenNumber, 101);
  assert.equal(sampleTokenOrder(at, settingsOf()).tokenNumber, 1, "no start set: the minimum");
  assert.equal(sampleTokenOrder(at, settingsOf({ billShowNumber: true, billNumberStart: 40 })).billNumber, 40);
  assert.equal(sampleTokenOrder(at, settingsOf({ billShowNumber: false })).billNumber, undefined, "no 'Bill n' in the sample when it would not print");
  assert.ok(sampleTokenOrder(at, settingsOf()).items.length > 0, "landmark: it has dishes to show");
});

test("the generic editor has no 'classic' literal left: it reads kind.todayDesign", () => {
  for (const file of GENERIC) {
    const src = raw(file);
    assert.ok(src.includes("kind.todayDesign"), `landmark: ${file} reads kind.todayDesign`);
    assert.ok(!/["'`]classic["'`]/.test(src), `${file}: no "classic" literal (raw source, comments included)`);
  }
  assert.ok(count(raw(GENERIC[0]), "kind.todayDesign") >= 2, "DesignSection: the pick and the customize sites use it");
  assert.ok(count(raw(GENERIC[1]), "activate(kind.todayDesign, legacy)") === 1, "the draft hook: recovery starts from it");
  assert.ok(raw("lib/print-design-kinds.ts").includes('todayDesign: "classic",'), "landmark: the bill and ticket kinds still say classic, in their own config");
});

test("no automatic setting flips: nothing in the token files sets, resets or auto-changes tokenEnabled or any form value", () => {
  for (const file of TOKEN_FILES) assert.ok(raw(file).length > 200, `landmark: ${file} was read`);
  assert.ok(code(SECTION).includes('useWatch({ control, name: "tokenEnabled" }) === true'), "landmark: the section only READS the switch");
  assert.ok(code(FIELDS).includes('name="tokenEnabled"'), "landmark: the switch is the plain form field");
  const flips = /\b(?:setValue|resetField|reset|setError|trigger)\(\s*["'`]?tokenEnabled|tokenEnabled\s*[:=]\s*true/;
  for (const file of [...TOKEN_FILES, ...GENERIC, "lib/print-design-editor.ts", "lib/print-design-kinds.ts"]) {
    assert.ok(!flips.test(code(file)), `${file}: no write of tokenEnabled`);
    assert.ok(!/\buseEffect\(/.test(code(file)), `${file}: no effect that could flip a setting by itself`);
  }
  assert.ok(!code(SECTION).includes("setValue") && !code(GALLERY).includes("setValue") && !code(DRAFT).includes("setValue"), "the design pieces are never handed the form's setValue");
  assert.ok(raw("components/settings/print-design/TokenDesignSection.tsx").includes("TOKENS_OFF_HINT") && !code(SECTION).includes("disabled"), "tokens off: only a hint, the editor stays usable");
});

test("the draft's type is TokenTemplate and the stored default round-trips the save path unchanged", () => {
  const draft: TokenTemplate = activate(TOKEN_EDITOR, "numberItems", settingsOf()).template;
  const body = TOKEN_KIND.bodyOf(draft);
  const parsed = updateSettingsSchema.parse(body);
  assert.deepEqual(parsed.tokenTemplate, draft, "the PUT's validator keeps the whole template (nothing dropped)");
});
