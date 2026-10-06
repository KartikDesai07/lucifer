import { BILL_FLAG_KEYS, flagsOf, settingsOf } from "./print-template-golden.fixtures"; // FIRST (selects React's production renderer; harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BILL_BLOCK_TYPES,
  BILL_DESIGNS,
  BILL_LOCKS,
  BILL_REQUIRED_BLOCKS,
  PRINT_FONT_KEYS,
  billBlockLocked,
  type BillTemplate,
  type SlipLockContext,
} from "@pos/shared/print-template";
import { PRINT_FONT_CATALOG, PRINT_FONT_KEY_FACE } from "@pos/shared/print-fonts";
import { billTemplateSchema } from "@pos/shared/schemas/print-template.schema";
import {
  BASE_FONT_CHOICES,
  BILL_EDITOR,
  EDITOR_HIDDEN_BLOCK_TYPES,
  activate,
  baselineOf,
  draftDirty,
  isEdited,
  lockContextOf,
  lockReasonOf,
  setBlockOn,
  templatesEqual,
} from "@/lib/print-design-editor";
import { BILL_BLOCK_LABEL, DESIGN_LABEL, FONT_LABEL, LOCK_REASON_TEXT, TOKEN_ROW_NOTE, turnedOnNotice } from "@/lib/print-design-labels";
import { BILL_KIND } from "@/lib/print-design-kinds";
import { defaultBillTemplate } from "@/lib/print-template-designs";
import type { Settings } from "@/types";

// Print customization S4 (04-S4-plan §5, plan Amendment A7): the Bill design editor's pure model. Signatures take the
// spec first. "Show bill number" is the sole bill-number control, so the editor forces billNo.on = true and never
// reports it as turned on. The ops, caps, random walk and write problems live in print-design-editor-ops.test.ts.

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const blockOn = (t: BillTemplate, type: string): boolean | undefined => t.blocks.find((b) => b.type === type)?.on;
const GST_STATES = [false, true] as const;
const FSSAI_STATES = ["", "11223344556677"] as const;

// ── Lock context ─────────────────────────────────────────────────────────────

test("lockContextOf: GST needs gstEnabled AND a rate above zero; FSSAI must be non-blank; banner is never a bill context", () => {
  const ctx = (s: Partial<Settings> | null | undefined): SlipLockContext => lockContextOf(s as Settings | null | undefined);
  assert.deepEqual(ctx(settingsOf({ gstEnabled: true, gstRate: 5 })), { gst: true, fssai: true, banner: false });
  assert.equal(ctx(settingsOf({ gstEnabled: true, gstRate: 0 })).gst, false, "GST on at a zero rate prints no tax, so no lock");
  assert.equal(ctx(settingsOf({ gstEnabled: false, gstRate: 5 })).gst, false);
  assert.equal(ctx(settingsOf({ fssai: "   " })).fssai, false, "a blank-ish FSSAI number locks nothing");
  assert.deepEqual(ctx(null), { gst: false, fssai: false, banner: false });
  assert.deepEqual(ctx(undefined), { gst: false, fssai: false, banner: false });
});

// ── activate ─────────────────────────────────────────────────────────────────

test("activate: 64 legacy masks x GST on/off x FSSAI x 4 designs is WRITE-valid, equals the design default except locked lines on and billNo on, turnedOn exact", () => {
  let cells = 0;
  let withTurnedOn = 0;
  let billNoForced = 0;
  for (const design of BILL_DESIGNS) {
    for (const gst of GST_STATES) {
      for (const fssai of FSSAI_STATES) {
        for (let mask = 0; mask < 1 << BILL_FLAG_KEYS.length; mask++) {
          const settings = settingsOf({ ...flagsOf(BILL_FLAG_KEYS, mask), gstEnabled: gst, gstRate: gst ? 5 : 0, fssai });
          const cell = `${design} gst=${gst} fssai=${fssai !== ""} mask=${mask}`;
          const ctx = { gst, fssai: fssai !== "", banner: false };
          const base = defaultBillTemplate(design, settings);
          const { template, turnedOn } = activate(BILL_EDITOR, design, settings);

          const parsed = billTemplateSchema.safeParse(template);
          assert.ok(parsed.success, `[${cell}] the activated design passes the WRITE gate`);

          const expectedTurnedOn: string[] = [];
          const expectedBlocks = base.blocks.map((block) => {
            if (block.type === "billNo") {
              if (!block.on) billNoForced++;
              return { ...block, on: true };
            }
            if (!block.on && billBlockLocked(block.type, ctx)) {
              expectedTurnedOn.push(block.type);
              return { ...block, on: true };
            }
            return block;
          });
          assert.deepEqual(template, { ...base, blocks: expectedBlocks }, `[${cell}] default with only locked lines + billNo switched on`);
          assert.deepEqual(turnedOn, expectedTurnedOn, `[${cell}] turnedOn lists exactly the lines the lock switched on`);
          assert.ok(!turnedOn.includes("billNo"), `[${cell}] billNo is forced on by the editor, never reported as turned on`);
          if (turnedOn.length > 0) withTurnedOn++;
          cells++;
        }
      }
    }
  }
  assert.equal(cells, 4 * 2 * 2 * 64, "landmark: the whole matrix ran");
  assert.ok(withTurnedOn > 0, "landmark: some cells really had a locked line to turn on (title on a GST bill, hidden GSTIN, ...)");
  assert.ok(billNoForced > 0, "landmark: some cells started with billNo off (Classic with Show bill number off) and were forced on");
});

test("activate: Classic follows the legacy toggles it is given, Modern/Express/Cafe ignore them; the base is a fresh object each time", () => {
  const off = settingsOf({ billShowLogo: false, billShowAddress: false, billShowGstNumber: false });
  assert.equal(blockOn(activate(BILL_EDITOR, "classic", off).template, "logo"), false, "Classic logo follows billShowLogo");
  assert.equal(blockOn(activate(BILL_EDITOR, "classic", settingsOf()).template, "logo"), true);
  assert.deepEqual(activate(BILL_EDITOR, "modern", off).template, activate(BILL_EDITOR, "modern", settingsOf()).template);
  const a = activate(BILL_EDITOR, "cafe", settingsOf()).template;
  const b = activate(BILL_EDITOR, "cafe", settingsOf()).template;
  assert.notEqual(a.blocks, b.blocks, "no shared block list between two activations");
  a.blocks[0].on = !a.blocks[0].on;
  assert.notEqual(a.blocks[0].on, b.blocks[0].on, "editing one start never leaks into the next");
});

test("activate: a GST Classic turns the title on (it prints TAX INVOICE) and says so in turnedOn", () => {
  const gst = activate(BILL_EDITOR, "classic", settingsOf({ gstEnabled: true, gstRate: 5, billShowAddress: false, billShowGstNumber: false }));
  assert.ok(gst.turnedOn.includes("title") && gst.turnedOn.includes("address") && gst.turnedOn.includes("gstin"), JSON.stringify(gst.turnedOn));
  assert.deepEqual(activate(BILL_EDITOR, "classic", settingsOf()).turnedOn.includes("title"), false, "no GST: the title stays off");
});

// ── lockReasonOf ─────────────────────────────────────────────────────────────

test("lockReasonOf: agrees with shared billBlockLocked for every type x every context, and names the table that locks it", () => {
  const reasons = new Set<string>();
  for (const gst of GST_STATES) {
    for (const fssai of GST_STATES) {
      for (const banner of GST_STATES) {
        const ctx: SlipLockContext = { gst, fssai, banner };
        for (const type of BILL_BLOCK_TYPES) {
          const reason = lockReasonOf(BILL_EDITOR, type, ctx);
          const cell = `${type} ${JSON.stringify(ctx)}`;
          assert.equal(reason !== null, billBlockLocked(type, ctx), `[${cell}] locked iff the shared contract says so`);
          assert.equal(BILL_EDITOR.isLocked(type, ctx), billBlockLocked(type, ctx), `[${cell}] spec.isLocked`);
          if (reason === null) continue;
          reasons.add(reason);
          const inTable = { always: BILL_LOCKS.always, gst: BILL_LOCKS.withGst, fssai: BILL_LOCKS.withFssai, banner: BILL_LOCKS.withBanner }[reason];
          assert.ok((inTable as readonly string[]).includes(type), `[${cell}] reason "${reason}" names a table that holds the type`);
        }
      }
    }
  }
  assert.deepEqual([...reasons].sort(), ["always", "fssai", "gst"], "landmark: every reason a bill can have was exercised (a bill has no banner lock)");
  assert.equal(lockReasonOf(BILL_EDITOR, "no-such-line", { gst: true, fssai: true, banner: true }), null, "an unknown type is never locked");
  assert.equal(lockReasonOf(BILL_EDITOR, "logo", { gst: true, fssai: true, banner: true }), null, "a free line has no reason");
});

// ── baseline, dirty, equality ────────────────────────────────────────────────

test("baselineOf: none / unreadable / ok, and an ok baseline gets every catalog line back (off) with billNo forced on", () => {
  assert.deepEqual(baselineOf(BILL_EDITOR, settingsOf()), { baseline: null, unreadable: false });
  assert.deepEqual(baselineOf(BILL_EDITOR, null), { baseline: null, unreadable: false });
  for (const junk of ["classic", 7, [], { v: 2 }, { ...defaultBillTemplate("modern", settingsOf()), design: "neon" }]) {
    assert.deepEqual(baselineOf(BILL_EDITOR, settingsOf({ billTemplate: junk })), { baseline: null, unreadable: true }, JSON.stringify(junk));
  }
  const modern = defaultBillTemplate("modern", settingsOf());
  const stored = clone(modern);
  stored.blocks = stored.blocks.filter((b) => b.type !== "tagline" && b.type !== "loyalty").map((b) => (b.type === "billNo" ? { ...b, on: false } : b));
  const { baseline, unreadable } = baselineOf(BILL_EDITOR, settingsOf({ billTemplate: stored }));
  assert.equal(unreadable, false);
  assert.ok(baseline, "landmark: the stored design read");
  const types = baseline.blocks.map((b) => b.type);
  for (const type of BILL_BLOCK_TYPES.filter((t) => !["divider", "customText", "qr"].includes(t))) {
    assert.equal(types.filter((t) => t === type).length, 1, `${type} appears exactly once in the baseline`);
  }
  assert.equal(blockOn(baseline, "tagline"), false, "a missing line comes back OFF");
  assert.equal(types[types.indexOf("name") + 1], "tagline", "...after its neighbour in the design's own order");
  assert.equal(blockOn(baseline, "billNo"), true, "billNo is forced on, whatever the stored value");
  assert.ok(billTemplateSchema.safeParse(baseline).success, "the baseline is WRITE-valid");
});

test("draftDirty: none / ok / unreadable, with and without `touched`", () => {
  const settings = settingsOf();
  const draft = activate(BILL_EDITOR, "express", settings).template;
  // none stored
  const none = baselineOf(BILL_EDITOR, settings);
  assert.equal(draftDirty(none, null, false), false, "no design stored, none drafted");
  assert.equal(draftDirty(none, draft, true), true, "a design was drafted over today's bill");
  // ok stored
  const ok = baselineOf(BILL_EDITOR, settingsOf({ billTemplate: clone(draft) }));
  assert.ok(ok.baseline, "landmark: stored design read");
  assert.equal(draftDirty(ok, clone(ok.baseline), false), false, "the draft equals what is saved");
  assert.equal(draftDirty(ok, null, true), true, "Back to today's bill over a saved design is a change");
  assert.equal(draftDirty(ok, setBlockOn(ok.baseline, "tagline", !blockOn(ok.baseline, "tagline")), true), true);
  // unreadable stored: only a choice counts
  const bad = baselineOf(BILL_EDITOR, settingsOf({ billTemplate: { v: 9 } }));
  assert.equal(bad.unreadable, true);
  assert.equal(draftDirty(bad, null, false), false, "left alone: nothing to send");
  assert.equal(draftDirty(bad, null, true), true, "Keep today's bill replaces the unreadable design");
  assert.equal(draftDirty(bad, draft, true), true, "a design chosen over it replaces it");
  assert.equal(draftDirty(bad, draft, false), false, "touched, not the draft, decides for an unreadable design");
});

test("templatesEqual: key order and undefined do not matter; block order, a value, a missing key do; toggle-and-back is not dirty", () => {
  const t = activate(BILL_EDITOR, "modern", settingsOf()).template;
  const reordered = { blocks: t.blocks.map((b) => ({ on: b.on, type: b.type, id: b.id, ...("options" in b ? { options: b.options } : {}) })), size: t.size, font: t.font, design: t.design, v: t.v };
  assert.ok(templatesEqual(t, reordered), "keys in another order");
  const withUndefined = { ...t, blocks: t.blocks.map((b) => ({ ...b, align: undefined, bold: undefined })) };
  assert.ok(templatesEqual(t, withUndefined), "undefined keys equal absent keys");
  assert.ok(!templatesEqual(t, { ...t, blocks: [t.blocks[1], t.blocks[0], ...t.blocks.slice(2)] }), "the ORDER of blocks matters");
  assert.ok(!templatesEqual(t, { ...t, font: "mono" }));
  assert.ok(!templatesEqual(t, { ...t, blocks: t.blocks.map((b, i) => (i === 3 ? { ...b, bold: false } : b)) }), "bold:false is not absent");
  const flipped = setBlockOn(t, "tagline", !blockOn(t, "tagline"));
  assert.ok(!templatesEqual(t, flipped), "landmark: one toggle is a difference");
  assert.ok(templatesEqual(t, setBlockOn(flipped, "tagline", blockOn(t, "tagline") as boolean)), "toggle and back is equal again");
  const settings = settingsOf();
  assert.equal(isEdited(BILL_EDITOR, t, settings), false, "a fresh start is not edited");
  assert.equal(isEdited(BILL_EDITOR, flipped, settings), true);
  assert.equal(isEdited(BILL_EDITOR, setBlockOn(flipped, "tagline", blockOn(t, "tagline") as boolean), settings), false, "toggle-and-back is not edited");
  const classic = activate(BILL_EDITOR, "classic", settings).template;
  assert.equal(isEdited(BILL_EDITOR, classic, settingsOf({ billShowLogo: false })), true, "Classic's start follows the toggles it is compared against");
});

// ── Fonts, labels, notices ───────────────────────────────────────────────────

test("BASE_FONT_CHOICES: geistMono plus every key whose face has aligned digits (slab is not offered), derived from the font catalog", () => {
  assert.equal(PRINT_FONT_CATALOG.slab.numbers, false, "landmark: slab has no tabular digits");
  assert.ok(BASE_FONT_CHOICES.includes("geistMono"), "the legacy face is always offered");
  assert.ok(!BASE_FONT_CHOICES.includes("slab"));
  for (const key of PRINT_FONT_KEYS) {
    const expected = key === "geistMono" || PRINT_FONT_CATALOG[PRINT_FONT_KEY_FACE[key]].numbers;
    assert.equal(BASE_FONT_CHOICES.includes(key), expected, `${key}: offered iff its digits line up`);
    assert.ok(FONT_LABEL[key].length > 0, `${key} has a label`);
  }
  assert.deepEqual([...BASE_FONT_CHOICES], ["geistMono", "mono", "sans", "condensed"]);
  assert.deepEqual([...EDITOR_HIDDEN_BLOCK_TYPES], ["station"], "only the kitchen station line (renders nothing until Phase 2) is hidden; the token line has a row since S6");
});

test("labels: every bill line, design, font and lock reason has a plain non-empty label; no label or notice is a field name or path", () => {
  assert.ok(BILL_BLOCK_TYPES.length > 0 && Object.keys(BILL_BLOCK_LABEL).length > 0, "landmark: the lists are non-empty");
  assert.deepEqual(Object.keys(BILL_BLOCK_LABEL).sort(), [...BILL_BLOCK_TYPES].sort(), "a label for every type and no extras");
  for (const type of BILL_BLOCK_TYPES) {
    const label = BILL_BLOCK_LABEL[type];
    assert.ok(typeof label === "string" && label.trim().length > 0, `${type} has a label`);
    assert.notEqual(label, type, `${type}'s label is words, not the field name`);
  }
  for (const design of BILL_DESIGNS) assert.ok(DESIGN_LABEL[design].length > 0);
  for (const reason of ["always", "gst", "fssai", "banner"] as const) assert.ok(LOCK_REASON_TEXT[reason].length > 0);
  for (const required of BILL_REQUIRED_BLOCKS) assert.ok(BILL_BLOCK_LABEL[required], `${required} (required on save) has a label`);
});

test("turnedOnNotice: one plain sentence per reason, naming only the lines turned on, ending with the not-saved-yet tail", () => {
  const tail = "Your printed bill does not change until you save.";
  assert.equal(turnedOnNotice(["GST number"], "gst"), `GST number is required on a GST bill, so it is turned on in your design. ${tail}`);
  assert.equal(
    turnedOnNotice(["GST number", "Address"], "gst"),
    `GST number and Address are required on a GST bill, so they are turned on in your design. ${tail}`,
  );
  assert.equal(
    turnedOnNotice(["Bill title", "GST number", "Address"], "gst"),
    `Bill title, GST number and Address are required on a GST bill, so they are turned on in your design. ${tail}`,
  );
  assert.ok(turnedOnNotice(["FSSAI number"], "fssai").includes("FSSAI number is required while an FSSAI number is set"));
  assert.ok(turnedOnNotice(["Total amount"], "always").includes("required on every slip"));
});

// ── Print customization S6: the token line has an editor row ─────────────────

test("BILL_KIND.noteOf: the token line carries TOKEN_ROW_NOTE in every design, no other bill line has a note, and the row is listed (not hidden)", () => {
  assert.ok(TOKEN_ROW_NOTE.length > 0 && TOKEN_ROW_NOTE.includes("Tokens & numbering"), "landmark: the note names the settings page that turns tokens on");
  let tokenRows = 0;
  for (const design of BILL_DESIGNS) {
    const t = activate(BILL_EDITOR, design, settingsOf()).template;
    for (const block of t.blocks) {
      assert.equal(BILL_KIND.noteOf(block, t as never), block.type === "token" ? TOKEN_ROW_NOTE : null, `${design}: ${block.type}`);
      if (block.type === "token") tokenRows++;
    }
  }
  assert.equal(tokenRows, BILL_DESIGNS.length, "landmark: every design carries exactly one token row");
  assert.ok(!BILL_EDITOR.hidden.includes("token"), "the token row is shown");
});

test("MIN-3(a): a stored design with its token line at a non-default index keeps it there, and the draft does not open dirty", () => {
  const settings = settingsOf();
  const stored = clone(defaultBillTemplate("classic", settings));
  const token = stored.blocks.find((b) => b.type === "token");
  assert.ok(token, "landmark: Classic has a token line");
  stored.blocks = stored.blocks.filter((b) => b.type !== "token");
  const afterOrderId = stored.blocks.findIndex((b) => b.type === "orderId") + 1;
  stored.blocks.splice(afterOrderId, 0, token);
  const savedIndex = stored.blocks.findIndex((b) => b.type === "token");
  assert.notEqual(savedIndex, defaultBillTemplate("classic", settings).blocks.findIndex((b) => b.type === "token"), "landmark: the saved index differs from the default");
  const base = baselineOf(BILL_EDITOR, settingsOf({ billTemplate: stored }));
  assert.ok(base.baseline, "landmark: the stored design read");
  assert.equal(base.baseline.blocks.findIndex((b) => b.type === "token"), savedIndex, "nothing moved the token line");
  assert.equal(draftDirty(base, clone(base.baseline), false), false, "the draft opens clean: nothing moved by itself");
});
