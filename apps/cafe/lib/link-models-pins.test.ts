import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-DL-2 T1a -- the wider ObjectId-link migration across models and the
// lib/routes that read/write those links (Product.categoryId,
// Order/OrderRequest/DuePayment/PromoRedemption's ObjectId reference paths).
// Pure source-text pins; no DB, no model compilation.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const readStripped = (rel: string): string => stripComments(readSrc(rel));

const PRODUCT_MODEL = "apps/cafe/models/Product.ts";
const ORDER_MODEL = "apps/cafe/models/Order.ts";
const DUE_PAYMENT_MODEL = "apps/cafe/models/DuePayment.ts";
const ORDER_REQUEST_MODEL = "apps/cafe/models/OrderRequest.ts";
const PROMO_REDEMPTION_MODEL = "apps/cafe/models/PromoRedemption.ts";
const RECONCILE_ROUTE = "apps/cafe/app/api/customers/[id]/reconcile/route.ts";
const DUE_PAYMENT_LIB = "apps/cafe/lib/due-payment.ts";
const ORDERS_ROUTE = "apps/cafe/app/api/orders/route.ts";

// Needles built by concatenation (testing.md rule) so a literal here can't
// trip this file's own scan or a sibling banned-string sweep.
const SCHEMA_OBJECT_ID = "Schema.Types" + ".ObjectId";
const REQUIRED_TRUE = "required" + ": true";
const INDEX_TRUE = "index" + ": true";

// -- models/Product.ts --------------------------------------------------------

test("PIN: Product.categoryId is a required, indexed ObjectId path; no category NAME path or a category-keyed index remains", () => {
  const src = readStripped(PRODUCT_MODEL);

  const categoryIdLine = src.split("\n").find((l) => l.includes("categoryId:") && l.includes(SCHEMA_OBJECT_ID));
  assert.ok(categoryIdLine, "expected a categoryId: { type: Schema.Types.ObjectId, ... } schema line");
  assert.ok(categoryIdLine!.includes(REQUIRED_TRUE), "categoryId must be required: true");
  assert.ok(categoryIdLine!.includes(INDEX_TRUE), "categoryId must be index: true");

  // Positive landmark for the negative pins below: categoryId itself must be
  // present twice (the IProduct interface field + the schema path), proving
  // the file was actually read and not blinded by stripComments.
  const categoryIdOccurrences = (src.match(/categoryId/g) ?? []).length;
  assert.ok(categoryIdOccurrences >= 2, "categoryId must appear at least twice (interface + schema path)");

  assert.ok(
    !/\bcategory\s*:\s*\{/.test(src) && !/\bcategory\s*:\s*string/.test(src),
    "Product must not declare a `category` NAME schema path or interface field any more",
  );
  assert.ok(
    !src.includes("index({ category: 1 })") && !src.includes('index({ category: "1"'),
    "Product must not declare an index({ category: 1 }) any more -- categoryId's own index: true covers lookups",
  );
});

// -- models/Order.ts ----------------------------------------------------------

test("PIN: Order.items[].productId AND Order.voids[].productId are BOTH required ObjectId paths (exactly 2 occurrences) -- the item subschema and the void-trail subschema must not drift apart", () => {
  const src = readStripped(ORDER_MODEL);
  const needle = "productId: { type: " + SCHEMA_OBJECT_ID + ", " + REQUIRED_TRUE + " }";
  const occurrences = src.split(needle).length - 1;
  assert.equal(
    occurrences,
    2,
    `expected exactly 2 occurrences of "${needle}" (item schema + void schema), found ${occurrences}`,
  );
});

test("PIN: Order.customerId and Order.staffId are plain (optional) ObjectId paths", () => {
  const src = readStripped(ORDER_MODEL);
  assert.ok(
    src.includes("customerId: { type: " + SCHEMA_OBJECT_ID + " }"),
    "customerId must be a plain (non-required) ObjectId schema path",
  );
  assert.ok(
    src.includes("staffId: { type: " + SCHEMA_OBJECT_ID + " }"),
    "staffId must be a plain (non-required) ObjectId schema path",
  );
});

test("PIN: Order.sourceRequestIds is an ObjectId array with default: undefined, AND the unique+sparse index on it still exists", () => {
  const src = readStripped(ORDER_MODEL);
  assert.ok(
    src.includes("sourceRequestIds: { type: [" + SCHEMA_OBJECT_ID + "], default: undefined }"),
    "sourceRequestIds must be typed [Schema.Types.ObjectId] with default: undefined (omit-empty, never [])",
  );
  assert.match(
    src,
    /orderSchema\.index\(\{\s*sourceRequestIds:\s*1\s*\},\s*\{\s*unique:\s*true,\s*sparse:\s*true\s*\}\)/,
    "orderSchema.index({ sourceRequestIds: 1 }, { unique: true, sparse: true }) must still be declared",
  );
});

// -- models/DuePayment.ts -----------------------------------------------------

test("PIN: DuePayment.customerId is a required, indexed ObjectId path", () => {
  const src = readStripped(DUE_PAYMENT_MODEL);
  assert.ok(
    src.includes("customerId: { type: " + SCHEMA_OBJECT_ID + ", " + REQUIRED_TRUE + ", " + INDEX_TRUE + " }"),
    "DuePayment.customerId must be { type: Schema.Types.ObjectId, required: true, index: true }",
  );
});

// -- models/OrderRequest.ts ---------------------------------------------------

test("PIN: OrderRequest item productId is a required ObjectId path", () => {
  const src = readStripped(ORDER_REQUEST_MODEL);
  assert.ok(
    src.includes("productId: { type: " + SCHEMA_OBJECT_ID + ", " + REQUIRED_TRUE + " }"),
    "OrderRequest item productId must be { type: Schema.Types.ObjectId, required: true }",
  );
});

// -- models/PromoRedemption.ts ------------------------------------------------

// CB-5D part 2 re-pointed this pin. `requestId` was `required: true` while the
// OrderRequest was the ONLY surface that could claim a promo fence; the counter
// now claims it too (app/api/orders/route.ts) and a counter order is born from
// no request, so requiredness had to go. What this pin protects is UNCHANGED
// and is re-stated below: the fence itself has always been the unique
// {code, mobile} index, never this field, and `code`/`mobile` stay required.
test("PIN: PromoRedemption keys the fence on {code, mobile} (both required) and its claimant fields are OPTIONAL — a counter claim carries claimOrderId, a diner claim carries requestId", () => {
  const src = readStripped(PROMO_REDEMPTION_MODEL);
  // The money fence: both halves of the unique key stay required.
  assert.ok(
    src.includes("code: { type: String, " + REQUIRED_TRUE + " }"),
    "PromoRedemption.code must stay required — it is half of the unique fence key",
  );
  assert.ok(
    src.includes("mobile: { type: String, " + REQUIRED_TRUE + " }"),
    "PromoRedemption.mobile must stay required — it is the other half, and it is the CUSTOMER identity that keeps the QR and counter surfaces in ONE fence",
  );
  assert.match(
    src,
    /promoRedemptionSchema\.index\(\{\s*code:\s*1,\s*mobile:\s*1\s*\},\s*\{\s*unique:\s*true\s*\}\)/,
    "the unique {code,mobile} compound index IS the fence and must remain",
  );
  // The claimant half: an ObjectId requestId OR a string claimOrderId, neither
  // required. A required requestId would make every counter claim throw.
  assert.ok(
    src.includes("requestId: { type: " + SCHEMA_OBJECT_ID + " }"),
    "PromoRedemption.requestId must be an OPTIONAL ObjectId path — the counter claims this fence with no OrderRequest to point at",
  );
  assert.ok(
    src.includes("claimOrderId: { type: String }"),
    "PromoRedemption.claimOrderId must exist as the counter's own claimant key, so a replay of the same order resumes instead of being refused",
  );
  assert.ok(
    !src.includes("requestId: { type: " + SCHEMA_OBJECT_ID + ", " + REQUIRED_TRUE + " }"),
    "PromoRedemption.requestId must NOT be required:true — that shape predates counter-side promos and would reject every counter claim",
  );
});

// -- app/api/customers/[id]/reconcile/route.ts -------------------------------

test("PIN: the reconcile route's $match casts the customer id with new Types.ObjectId(id) -- a raw aggregate $match does not auto-cast like a query filter", () => {
  const src = readStripped(RECONCILE_ROUTE);
  // Positive landmark: the route must still import Types from mongoose.
  assert.match(src, /import\s+mongoose,\s*\{\s*Types\s*\}\s*from\s*"mongoose"/, "the route must import { Types } from mongoose");
  assert.ok(
    src.includes("$match: { customerId: new Types.ObjectId(id)"),
    "the $match stage must cast the customer id via new Types.ObjectId(id)",
  );
});

// -- lib/due-payment.ts -------------------------------------------------------

test("PIN: duesPaidTotal's $match casts via new mongoose.Types.ObjectId(canonicalCustomerId(...)), and replayMismatch compares String(existing.customerId)", () => {
  const src = readStripped(DUE_PAYMENT_LIB);

  // Positive landmark: both function names must still be declared.
  assert.match(src, /function duesPaidTotal\(/, "duesPaidTotal must still be declared");
  assert.match(src, /function replayMismatch\(/, "replayMismatch must still be declared");

  assert.ok(
    src.includes("new mongoose.Types.ObjectId(canonicalCustomerId("),
    "duesPaidTotal's aggregate $match must cast via new mongoose.Types.ObjectId(canonicalCustomerId(...))",
  );
  assert.ok(
    src.includes("String(existing.customerId)"),
    "replayMismatch must compare String(existing.customerId) against the canonicalised input id",
  );
});

// -- app/api/orders/route.ts --------------------------------------------------

test("PIN: the create-order doc literal stamps staffId from the session, immediately after the receiver field (order pinned, both present)", () => {
  const src = readStripped(ORDERS_ROUTE);

  const receiverIdx = src.indexOf("receiver:");
  assert.ok(receiverIdx !== -1, "the doc literal must include a receiver: field");
  const staffIdIdx = src.indexOf("staffId: authed.session.user.id", receiverIdx);
  assert.ok(
    staffIdIdx !== -1,
    "staffId: authed.session.user.id must appear at or after the receiver: field",
  );

  // Order pin: nothing else field-shaped sits between the two lines (allows
  // only whitespace and the receiver value/comment on receiver's own line).
  const between = src.slice(receiverIdx, staffIdIdx);
  const lines = between.split("\n").map((l) => l.trim()).filter(Boolean);
  assert.equal(lines.length, 1, `expected only the receiver: line between receiver and staffId, found: ${JSON.stringify(lines)}`);
});

// ══════════════════════════════════════════════════════════════════════════
// C15 (arbiter-confirmed) — stale comments describe pre-DL-2 String fields.
// RAW-source pins (not comment-stripped, since the assertion IS about the
// comment text), each paired with a positive landmark that the load-bearing
// CODE beside the stale comment is still there.
// ══════════════════════════════════════════════════════════════════════════

const PUBLIC_SHARED = "packages/shared/src/public.ts";
const ORDER_REQUEST_EDIT_LIB = "apps/cafe/lib/order-request-edit.ts";
const DUE_PAYMENT_ADMIN_LIB = "apps/cafe/lib/due-payment-admin.ts";
const USE_CATEGORIES_HOOK = "apps/cafe/hooks/use-categories.ts";

// Comment prose wraps across multiple `//` lines, so a phrase pin must tolerate
// a newline PLUS the next line's own leading `// ` marker wherever a space
// could naturally fall. Strip a line-start `//` marker first (so "can\n//
// only" rejoins as "can only", not "can // only"), then collapse whitespace
// runs to one space (mirrors go-live-dl.test.ts's own norm()).
function normWs(s: string): string {
  return s.replace(/^[ \t]*\/\/ ?/gm, " ").replace(/\s+/g, " ").trim();
}

test("PIN (raw source): packages/shared/src/public.ts's PublicStatusItem comment no longer claims productId is 'already a string, never a raw ObjectId' -- it must say the model field IS an ObjectId and String(...) is the real serialisation boundary. Positive landmark: the String(item.productId) cast itself is unchanged.", () => {
  const src = readSrc(PUBLIC_SHARED); // raw -- the assertion is about comment text itself
  const flat = normWs(src);

  assert.ok(
    src.includes("productId: string"),
    "positive landmark: PublicStatusItem must still declare productId: string",
  );

  assert.ok(
    !/already a string, never a raw ObjectId/.test(flat),
    "the stale comment claiming productId is 'already a string, never a raw ObjectId' must be gone",
  );
  assert.match(
    flat,
    /model's own field is an ObjectId.*String\(\.\.\.\) cast.*REAL serialisation boundary/,
    "the corrected comment must say the model field is an ObjectId and the String(...) cast is the REAL serialisation boundary",
  );
});

test("PIN (raw source): lib/order-request-edit.ts's toStatusItems comment no longer claims productId is 'already a string, never a raw ObjectId' -- it must say the model field IS an ObjectId. Positive landmark: the String(item.productId) cast itself is unchanged.", () => {
  const src = readSrc(ORDER_REQUEST_EDIT_LIB); // raw -- comment text is the assertion
  const flat = normWs(src);

  assert.ok(
    src.includes("productId: String(item.productId)"),
    "positive landmark: toStatusItems must still cast productId: String(item.productId)",
  );

  assert.ok(
    !/already a string, never a raw ObjectId/.test(flat),
    "the stale comment claiming productId is 'already a string, never a raw ObjectId' must be gone",
  );
  assert.match(
    flat,
    /model's own field is an ObjectId.*REAL serialisation boundary/,
    "the corrected comment must say the model field is an ObjectId and String(...) is the REAL serialisation boundary, not a defensive cast",
  );
});

test("PIN (raw source): due-payment-admin.ts's customerIdFilter comment no longer says customerId 'is a stored STRING' -- it must say stored ObjectId, and must ADD the clause explaining the raw $in is safe only because every caller is a Mongoose model query. Positive landmarks: the dual-spelling $in itself, and the { $in: [...] } return shape, are both unchanged.", () => {
  const src = readSrc(DUE_PAYMENT_ADMIN_LIB); // raw -- comment text is the assertion
  const flat = normWs(src);

  // Positive landmarks: the dual-spelling $in is untouched.
  assert.match(
    src,
    /return\s*\{\s*\$in:\s*\[\s*customerId,\s*canonicalCustomerId\(customerId\)\s*\]\s*\}/,
    "positive landmark: customerIdFilter's dual-spelling { $in: [customerId, canonicalCustomerId(customerId)] } must be unchanged",
  );

  assert.ok(
    !/customerId.{0,10}is a stored STRING/.test(flat),
    "the stale comment claiming customerId 'is a stored STRING' must be gone -- CB-DL-2 flipped it to an ObjectId",
  );
  assert.match(flat, /stored ObjectId/, "the corrected comment must say customerId is a stored ObjectId");
  assert.match(
    flat,
    /safe only because every caller here is a Mongoose model query/,
    "the comment must add the clause: safe only because every caller here is a Mongoose model query (auto-casts a string against an ObjectId path)",
  );
  assert.match(
    flat,
    /raw aggregate `?\$match`? would need an explicit.*ObjectId.*cast/,
    "the comment must say a raw aggregate $match would need an explicit ObjectId cast instead",
  );
});

test("PIN (raw source): hooks/use-categories.ts's comment no longer claims deleting a category reassigns products to Uncategorized server-side -- it must state the real reason the products list is still invalidated, and must NOT drop the extraInvalidate remove of the product keys.", () => {
  const src = readSrc(USE_CATEGORIES_HOOK); // raw -- comment text is the assertion
  const flat = normWs(src);

  // Positive landmark: extraInvalidate's remove of the product keys itself
  // must still be there, unchanged.
  assert.match(
    src,
    /extraInvalidate:\s*\{\s*remove:\s*\[PRODUCT_KEYS\.all\]\s*\}/,
    "positive landmark: extraInvalidate: { remove: [PRODUCT_KEYS.all] } must still be present -- this fix must not drop it",
  );

  assert.ok(
    !/reassigns its products to "Uncategorized" server-side/.test(flat),
    "the stale comment claiming a category delete reassigns its products to Uncategorized server-side must be gone -- CB-DL-2 replaced that cascade with a 409 refusal",
  );
  assert.match(
    flat,
    /can only be deleted once it has no products/,
    "the corrected comment must state the real reason: a category can only be deleted once it has no products",
  );
  assert.match(
    flat,
    /stale cached products list.{0,120}category id that was just removed/,
    "the corrected comment must explain WHY the products list invalidation stays: a stale cached products list could still show a removed category's id",
  );
});
