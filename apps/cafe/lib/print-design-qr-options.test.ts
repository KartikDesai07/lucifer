import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import type { QrOptions } from "@pos/shared/print-template";
import { billTemplateSchema, billTemplateReadSchema } from "@pos/shared/schemas/print-template.schema";
import { defaultBillTemplate } from "@/lib/print-template-designs";
import { setQrOptions } from "@/lib/print-design-editor-ops";
import { withCaption, withContent, withSize } from "@/lib/print-design-qr-options";
import { settingsOf } from "./print-template-golden.fixtures";

// The QR options editor's pure edits: a size (like a caption) survives a content switch and any other edit, Normal removes
// the key, and the whole chain still parses through the save gate and the read schema.
const BIG_UPI: QrOptions = { content: "upi", caption: "Pay here", size: "large" };

test("withSize: a bigger size is written, Normal REMOVES the key, and nothing else changes", () => {
  const link: QrOptions = { content: "link", url: "https://example.com", caption: "Menu" };
  assert.deepEqual(withSize(link, "xlarge"), { ...link, size: "xlarge" });
  assert.deepEqual(withSize(withSize(link, "large"), "normal"), link);
  assert.ok(!("size" in withSize(BIG_UPI, "normal")), "the key is gone, not set to normal");
  assert.deepEqual(link, { content: "link", url: "https://example.com", caption: "Menu" }, "the input is not mutated");
});

test("withContent: the size and the caption are carried across a switch, in both directions", () => {
  const toLink = withContent(BIG_UPI, "link");
  assert.deepEqual(toLink, { content: "link", url: "", caption: "Pay here", size: "large" });
  assert.deepEqual(withContent(toLink, "upi"), BIG_UPI);
  assert.deepEqual(withContent({ content: "upi" }, "link"), { content: "link", url: "" }, "a Normal, caption-less code gains neither key");
  assert.equal(withContent(BIG_UPI, "upi"), BIG_UPI, "choosing the current content changes nothing");
});

test("withCaption keeps the size: typing a caption and clearing it never drops it", () => {
  const typed = withCaption(BIG_UPI, "New words");
  assert.deepEqual(typed, { content: "upi", caption: "New words", size: "large" });
  assert.deepEqual(withCaption(typed, ""), { content: "upi", size: "large" });
});

test("a size set through the editor op survives the save gate and the read schema (save -> reload -> print)", () => {
  const settings = settingsOf({ upiId: "samplecafe@okaxis" });
  const base = defaultBillTemplate("modern", settings);
  const qr = base.blocks.find((b) => b.type === "qr");
  assert.ok(qr, "landmark: the design carries a QR line");
  const edited = setQrOptions(base, qr.id, withSize(withCaption({ content: "upi" }, "Scan to pay"), "xlarge"));
  for (const schema of [billTemplateSchema, billTemplateReadSchema]) {
    const parsed = schema.parse(edited);
    const options = parsed.blocks.find((b) => b.type === "qr")?.options as QrOptions;
    assert.deepEqual(options, { content: "upi", caption: "Scan to pay", size: "xlarge" });
  }
});

test("the editor is wired: QrOptionsFields uses the pure edits and offers the three sizes, with no private option copy left", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "../components/settings/print-design/QrOptionsFields.tsx"), "utf8");
  assert.ok(src.includes("withContent(options, content)") && src.includes("withSize(options, size)"), "uses the pure edits");
  assert.ok(src.includes("PRINT_QR_SIZES") && src.includes("Extra large") && src.includes("Normal (default)"), "offers the three sizes");
  assert.ok(!src.includes('{ content: "link", url: "" }'), "no component-local rebuild of the options (it would drop a new key)");
});
