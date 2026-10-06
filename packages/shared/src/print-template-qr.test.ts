import { test } from "node:test";
import assert from "node:assert/strict";
import { PRINT_QR_CAPTION_MAX, PRINT_QR_URL_MAX } from "./print-template";
import { billTemplateSchema, kotTemplateSchema, tokenTemplateSchema } from "./schemas/print-template.schema";
import {
  accepts,
  billFixture,
  kotFixture,
  plain,
  qr,
  rejects,
  tokenFixture,
  wrap,
  type Block,
  type Template,
} from "./print-template-fixtures";

// The QR line in each kind: the bill's may be upi or a link; the kitchen ticket's and the token's is a link only.
const onBill = (options: Block): Template => ({ ...billFixture(), blocks: [...billFixture().blocks, qr(1, options)] });
const onKot = (options: Block): Template => ({ ...kotFixture(), blocks: [...kotFixture().blocks, qr(1, options)] });
const onToken = (options: Block): Template => wrap("bigNumber", [plain("tokenNo"), qr(1, options)]);
const billQr = `blocks.${billFixture().blocks.length}`;
const kotQr = `blocks.${kotFixture().blocks.length}`;

test("upi is a bill-only QR: rejected on a kitchen ticket and on a token", () => {
  accepts(billTemplateSchema, onBill({ content: "upi" }));
  accepts(billTemplateSchema, onBill({ content: "upi", caption: "Pay here" }));
  rejects(kotTemplateSchema, onKot({ content: "upi" }), `${kotQr}.options.content`);
  rejects(tokenTemplateSchema, onToken({ content: "upi" }), "blocks.1.options.content");
});

test("a link QR needs a url; a upi QR takes none", () => {
  rejects(billTemplateSchema, onBill({ content: "link" }), `${billQr}.options.url`);
  rejects(kotTemplateSchema, onKot({ content: "link" }), `${kotQr}.options.url`);
  rejects(tokenTemplateSchema, onToken({ content: "link" }), "blocks.1.options.url");
  rejects(billTemplateSchema, onBill({ content: "upi", url: "https://example.com" }), `${billQr}.options`);
  rejects(billTemplateSchema, onBill({ content: "email" }), `${billQr}.options.content`);
});

test("QR links: https, visible ASCII, bounded", () => {
  const bad = [
    "https://x.com/a b",
    "https://x.com/\u200b", // zero-width space
    "\u0001https://x.com", // control character
    "https://x.com/caf\u00e9", // non-ASCII
    "http://x.com",
    "javascript:alert(1)",
    "not a url",
    "https://",
    "",
    "https:example.com", // the URL parser accepts these, but nobody typed a real link
    "https:/example.com",
    "https:\\\\example.com", // https: then two backslashes
    "https:///example.com",
    "HTTPS://EXAMPLE.COM",
    "Https://example.com",
    "https://user:pass@example.com",
    "https://user@example.com",
    "https://example.com\\path", // a backslash after the host
    "https://?q=1",
  ];
  for (const url of bad) {
    rejects(tokenTemplateSchema, onToken({ content: "link", url }), "blocks.1.options.url");
    rejects(billTemplateSchema, onBill({ content: "link", url }), `${billQr}.options.url`);
  }
  for (const url of ["https://example.com/menu?t=4", "https://example.com", "https://example.com:8443/a#b", "https://xn--caf-dma.com/", "https://example.com/a%20b"]) {
    accepts(tokenTemplateSchema, onToken({ content: "link", url }), url);
    accepts(kotTemplateSchema, onKot({ content: "link", url }), url);
    accepts(billTemplateSchema, onBill({ content: "link", url }), url);
  }
  // surrounding whitespace is trimmed, not rejected
  const parsed = tokenTemplateSchema.parse(onToken({ content: "link", url: "  https://example.com/a  " }));
  assert.equal((parsed.blocks[1] as unknown as { options: { url: string } }).options.url, "https://example.com/a");
  const long = `https://example.com/${"a".repeat(PRINT_QR_URL_MAX)}`;
  rejects(tokenTemplateSchema, onToken({ content: "link", url: long.slice(0, PRINT_QR_URL_MAX + 1) }), "blocks.1.options.url");
  accepts(tokenTemplateSchema, onToken({ content: "link", url: long.slice(0, PRINT_QR_URL_MAX) }));
});

test("QR caption: trimmed, 1..60", () => {
  const link = { content: "link", url: "https://example.com" };
  accepts(tokenTemplateSchema, onToken({ ...link, caption: "c".repeat(PRINT_QR_CAPTION_MAX) }));
  rejects(tokenTemplateSchema, onToken({ ...link, caption: "c".repeat(PRINT_QR_CAPTION_MAX + 1) }), "blocks.1.options.caption");
  rejects(tokenTemplateSchema, onToken({ ...link, caption: "  " }), "blocks.1.options.caption");
  rejects(billTemplateSchema, onBill({ content: "upi", caption: "" }), `${billQr}.options.caption`);
});
