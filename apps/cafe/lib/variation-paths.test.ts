import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// SLICE F — pins for the menu-item VARIATIONS feature (SPEC-variations.md) that
// have NO other test coverage. There is no React/route test framework in this
// repo (deliberate — see print-paths.test.ts's header), so every pin below is a
// source-read pin (readFileSync over the REAL source), same technique as
// print-paths.test.ts and table-flow-paths.test.ts.
//
// NOT duplicated here — already pinned elsewhere, look there instead:
//   - lib/variations.test.ts: checkItemVariations' own logic, all 8 cases
//     (plain item, matching variation, REQUIRED, UNKNOWN both directions,
//     unknown productId skipped, empty items, first-bad-line-wins). This file
//     only pins that the two ROUTES actually call it, and call it before
//     their write — not its internal correctness.
//   - packages/shared/src/utils.test.ts: orderLineKey's append-only-when-
//     present contract, byte-for-byte against the pre-variations format, and
//     orderItemLabel's own rendering — both already unit-pinned there (Slice A).
//   - packages/shared/src/schemas/product.schema.test.ts: productVariationSchema
//     and createProductSchema.variations' Zod-level shape (bounds, dedupe,
//     omit-empty on the wire), and the CSV-import-never-sends-variations claim
//     at the schema layer.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Pins forbid/require CODE shapes, so they must look at code and not at prose —
// a comment explaining the rule would otherwise trip the very pin meant to
// enforce it (table-flow-paths.test.ts's note; this repo has been bitten by it).

// Brace-balanced scan (print-paths.test.ts) — pulls a whole function/JSX BODY
// out of the source without truncating on the first nested `}` a naive
// indexOf("}...") would hit.
function matchingBraceEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingBraceEnd: no matching closing brace found");
}

// Same idea, paren-balanced — needed to pull a whole `.map((item, i) => (...))`
// JSX block out of a receipt without truncating on the first nested `)`.
function matchingParenEnd(src: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("matchingParenEnd: no matching closing paren found");
}

const USE_CART = "apps/cafe/hooks/use-cart.ts";
const MODIFIER_MODAL = "apps/cafe/components/pos/ModifierModal.tsx";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const KOT_RECEIPT = "apps/cafe/components/pos/KOTReceipt.tsx";
const ORDER_RECEIPT = "apps/cafe/components/pos/OrderReceipt.tsx";
const ORDERS_ROUTE = "apps/cafe/app/api/orders/route.ts";
const ORDER_ITEMS_ROUTE = "apps/cafe/app/api/orders/[id]/items/route.ts";
const PRODUCT_MODEL = "apps/cafe/models/Product.ts";
const VOID_ITEM_DIALOG = "apps/cafe/components/pos/VoidItemDialog.tsx";
const USE_POS_PRINT = "apps/cafe/hooks/use-pos-print.ts";

// ── 1. use-cart.ts: a Small and a Large must not merge into one line ────────

test("PIN: use-cart.ts's lineKey takes a `variation` argument and folds it into the key, and addToCart threads the caller's selection through to both the key and the line's price — without this a Small and a Large of the same product collapse into one cart line", () => {
  const src = stripComments(readSrc(USE_CART));

  const lineKeyStart = src.indexOf("function lineKey(");
  assert.ok(lineKeyStart >= 0, "lineKey must exist");
  const sigOpen = lineKeyStart + "function lineKey(".length - 1;
  assert.equal(src[sigOpen], "(", "marker must end on lineKey's parameter-list opening paren");
  const sigClose = matchingParenEnd(src, sigOpen);
  const signature = src.slice(sigOpen, sigClose + 1);
  assert.match(
    signature,
    /variation\?:\s*string/,
    "lineKey must accept an optional `variation` parameter, appended after the existing args (existing call sites need only one new arg)",
  );

  const bodyOpen = src.indexOf("{", sigClose);
  const bodyClose = matchingBraceEnd(src, bodyOpen);
  const body = src.slice(bodyOpen, bodyClose + 1);
  assert.match(
    body,
    /variation \?\? ""/,
    "the returned key must fold in the variation (empty string when absent) — otherwise two different sizes of the same product/modifiers/instructions produce the SAME key and merge",
  );

  const addToCartStart = src.indexOf("const addToCart = useCallback");
  assert.ok(addToCartStart >= 0, "addToCart must exist");
  const updateQtyStart = src.indexOf("const updateQty = useCallback", addToCartStart);
  assert.ok(updateQtyStart > addToCartStart, "updateQty must be declared after addToCart");
  const addToCartBody = src.slice(addToCartStart, updateQtyStart);

  assert.match(
    addToCartBody,
    /const variation = opts\.variation;/,
    "addToCart must read the caller's chosen variation off opts",
  );
  assert.match(
    addToCartBody,
    /const key = lineKey\(product\._id, modifiers, instructions, variation\);/,
    "addToCart must pass the variation into lineKey — reading opts.variation without threading it into the key would still merge Small and Large",
  );
  assert.match(
    addToCartBody,
    /const price = chosenVariation\s*\n?\s*\?\s*effectivePrice\(\{\s*price:\s*chosenVariation\.price,\s*discount:\s*product\.discount\s*\}\)\s*\n?\s*:\s*effectivePrice\(product\);/,
    "the line's price must come from the CHOSEN variation's own price run through effectivePrice, falling back to the product's own price only when no variation resolved",
  );
  assert.match(
    addToCartBody,
    /^\s+variation,\s*$/m,
    "the stored cart line must carry the variation forward — a resumed tab or a void re-sync would otherwise lose which size was ordered",
  );
});

// ── 2. ModifierModal: no silent default to the first/cheapest size ─────────

test("PIN: ModifierModal disables Add until a variation is picked when the product has any, never seeds a default, and picking a size only selects it (never auto-confirms)", () => {
  const src = stripComments(readSrc(MODIFIER_MODAL));

  assert.match(
    src,
    /const \[variation, setVariation\] = useState<string \| undefined>\(undefined\);/,
    "variation must start UNPICKED — seeding it with variations[0] would let the confirm button fire right away and silently bill the cheapest size",
  );
  assert.match(
    src,
    /const hasVariations = \(product\.variations\?\.length \?\? 0\) > 0;/,
  );
  assert.match(
    src,
    /const confirmDisabled = hasVariations && !variation;/,
    "confirm must be disabled exactly when the product has variations and none is picked yet",
  );
  assert.match(src, /disabled=\{confirmDisabled\}/, "the confirm Button must actually wire up confirmDisabled");

  // The reset effect (product/open changes) must re-clear the pick — a size
  // left over from the PREVIOUS product must never leak into this one.
  const resetStart = src.indexOf("useEffect(() => {");
  assert.ok(resetStart >= 0, "the reset effect must exist");
  const resetOpen = src.indexOf("{", resetStart + "useEffect(() => ".length);
  const resetClose = matchingBraceEnd(src, resetOpen);
  const resetBody = src.slice(resetOpen, resetClose + 1);
  assert.match(resetBody, /setVariation\(undefined\);/, "the reset effect must clear the selection for the next product");

  // The variation chooser itself: picking a tile must only set state, never
  // fire the confirm handler directly — the operator must still explicitly
  // tap Add, same as with modifiers/qty.
  const pickerMarker = "{hasVariations && (";
  const pickerStart = src.indexOf(pickerMarker);
  assert.ok(pickerStart >= 0, "the variation chooser must be gated on hasVariations");
  const pickerOpen = pickerStart + pickerMarker.length - 1;
  assert.equal(src[pickerOpen], "(", "marker must end on the JSX-wrapping opening paren");
  const pickerClose = matchingParenEnd(src, pickerOpen);
  const pickerBlock = src.slice(pickerOpen, pickerClose + 1);
  assert.match(
    pickerBlock,
    /onClick=\{\(\) => setVariation\(v\.name\)\}/,
    "a variation tile's onClick must only call setVariation",
  );
  assert.ok(
    !/confirm\(\)/.test(pickerBlock),
    "the variation chooser must never call confirm() directly — an item sold by size has no meaningful default, so the operator must still tap Add",
  );
});

// ── 3. pos/page.tsx: a variation item must never add straight to the cart ──

test("PIN: pos/page.tsx's handleProductClick opens the modifier modal for a variation product exactly like a modifiers product — the direct add-to-cart path is only its ELSE branch", () => {
  const src = stripComments(readSrc(POS_PAGE));

  const marker = "const handleProductClick = (product: Product) => {";
  const markerStart = src.indexOf(marker);
  assert.ok(markerStart >= 0, "handleProductClick must exist with this signature");
  const braceOpen = markerStart + marker.length - 1;
  assert.equal(src[braceOpen], "{", "marker must end on the function's opening brace");
  const braceClose = matchingBraceEnd(src, braceOpen);
  const body = src.slice(braceOpen, braceClose + 1);

  assert.match(
    body,
    /if \(product\.modifiers\.length > 0 \|\| \(product\.variations\?\.length \?\? 0\) > 0\) \{/,
    "the modal-open condition must check variations too — otherwise a variation item with no modifiers adds straight to the cart with no size chosen and no meaningful default price",
  );
  const ifIdx = body.indexOf("if (product.modifiers.length > 0");
  const elseIdx = body.indexOf("} else {", ifIdx);
  assert.ok(elseIdx > ifIdx, "the direct add-to-cart branch must be the ELSE of that same condition, not a separately reachable path");
  const thenBranch = body.slice(ifIdx, elseIdx);
  const elseBranch = body.slice(elseIdx);

  assert.match(thenBranch, /setModifierProduct\(product\);/);
  assert.match(thenBranch, /setModifierOpen\(true\);/);
  assert.match(elseBranch, /pos\.addToCart\(product\);/);
  assert.ok(
    !/pos\.addToCart\(/.test(thenBranch),
    "the modal-open branch must NOT also add straight to the cart",
  );
});

// ── 4. Every renderer of an item's name goes through orderItemLabel ────────

test("PIN: KOTReceipt's item rows render the label ONLY via orderItemLabel(item), on the BOLD qty-and-name line — a cook scanning a rail must not have to hunt a sub-line for the size, and no hand-built variation suffix can drift from the shared helper", () => {
  const src = stripComments(readSrc(KOT_RECEIPT));
  assert.match(src, /import \{ orderItemLabel \} from "@pos\/shared\/utils";/);

  const marker = "items.map((item, i) => (";
  const mapStart = src.indexOf(marker);
  assert.ok(mapStart >= 0, "the item rows must be built from items.map((item, i) => (...))");
  const openParen = mapStart + marker.length - 1;
  assert.equal(src[openParen], "(", "marker must end on the JSX-wrapping opening paren");
  const closeParen = matchingParenEnd(src, openParen);
  const rowBlock = src.slice(openParen, closeParen + 1);

  const labelCalls = rowBlock.match(/orderItemLabel\(item\)/g) ?? [];
  assert.equal(labelCalls.length, 1, "the row must call orderItemLabel(item) exactly once");
  assert.ok(
    !/item\.variation/.test(rowBlock),
    "the row must never touch item.variation directly — every reference to it must flow through orderItemLabel(item), or this row and the shared label helper can silently start disagreeing",
  );

  const boldIdx = rowBlock.indexOf('font-bold">');
  assert.ok(boldIdx >= 0, "the row must have a bold qty+name line");
  const boldLine = rowBlock.slice(boldIdx, rowBlock.indexOf("</span>", boldIdx));
  assert.match(
    boldLine,
    /\{item\.qty\} × \{orderItemLabel\(item\)\}/,
    "the variation must ride the BOLD line itself, not a sub-line below it",
  );
});

test("PIN: OrderReceipt's item rows render the label ONLY via orderItemLabel(item) — no hand-built `${name} (${variation})` anywhere in the row", () => {
  const src = stripComments(readSrc(ORDER_RECEIPT));
  assert.match(src, /import \{ orderItemLabel \} from "@pos\/shared\/utils";/);

  const marker = "order.items.map((item, i) => (";
  const mapStart = src.indexOf(marker);
  assert.ok(mapStart >= 0, "the item rows must be built from order.items.map((item, i) => (...))");
  const openParen = mapStart + marker.length - 1;
  assert.equal(src[openParen], "(", "marker must end on the JSX-wrapping opening paren");
  const closeParen = matchingParenEnd(src, openParen);
  const rowBlock = src.slice(openParen, closeParen + 1);

  const labelCalls = rowBlock.match(/orderItemLabel\(item\)/g) ?? [];
  assert.equal(labelCalls.length, 1, "the row must call orderItemLabel(item) exactly once");
  assert.ok(
    !/item\.variation/.test(rowBlock),
    "the row must never touch item.variation directly — a hand-built label here is exactly what lets the bill and the KOT disagree",
  );
});

// ── 5. Both order write paths reject a bad variation BEFORE their write ────

test("PIN: POST /api/orders calls checkItemVariations and returns its rejection BEFORE resolveTableCharge (pricing) and the order write — a bad payload must cost nothing", () => {
  const src = stripComments(readSrc(ORDERS_ROUTE));
  assert.match(src, /import \{ checkItemVariations \} from "@\/lib\/variations";/);

  const postStart = src.indexOf("export async function POST(req: Request) {");
  assert.ok(postStart >= 0, "POST must exist with this signature");

  const checkIdx = src.indexOf("checkItemVariations(", postStart);
  assert.ok(checkIdx > postStart, "checkItemVariations must be called inside POST");
  const failureIdx = src.indexOf("if (bad) return failure(bad, 400);", checkIdx);
  assert.ok(failureIdx > checkIdx, "the rejection must be returned right after the check");

  const chargeIdx = src.indexOf("resolveTableCharge(data.tableNo)", postStart);
  assert.ok(chargeIdx > failureIdx, "resolveTableCharge (pricing) must run AFTER the variation check returns, not before");

  const createIdx = src.indexOf("Order.create({ ...doc", postStart);
  assert.ok(createIdx > failureIdx, "the order write must also happen after the variation check");
});

test("PIN: POST /api/orders/[id]/items calls checkItemVariations and returns its rejection BEFORE the guarded CAS write — a bad round never touches the tab", () => {
  const src = stripComments(readSrc(ORDER_ITEMS_ROUTE));
  assert.match(src, /import \{ checkItemVariations \} from "@\/lib\/variations";/);

  const postStart = src.indexOf("export async function POST(req: Request, { params }: Params) {");
  assert.ok(postStart >= 0, "POST must exist with this signature");

  const checkIdx = src.indexOf("checkItemVariations(", postStart);
  assert.ok(checkIdx > postStart, "checkItemVariations must be called inside POST");
  const failureIdx = src.indexOf("if (bad) return failure(bad, 400);", checkIdx);
  assert.ok(failureIdx > checkIdx, "the rejection must be returned right after the check");

  const casIdx = src.indexOf("await Order.findOneAndUpdate(filter, update,", postStart);
  assert.ok(casIdx > failureIdx, "the guarded CAS write must happen strictly after the variation check returns");
});

// ── 6. Product.ts's variations field is genuinely omit-empty ───────────────

test("PIN: models/Product.ts's variations field declares `default: undefined` (omit-empty) on a `{ _id: false }` sub-document array — a stray [] default or an auto-_id would defeat the 512MB-M0 omit-empty story this feature relies on", () => {
  const src = stripComments(readSrc(PRODUCT_MODEL));

  const subSchemaStart = src.indexOf(
    "const productVariationSchema = new Schema<ProductVariation>(",
  );
  assert.ok(subSchemaStart >= 0, "productVariationSchema must exist");
  const idFalseIdx = src.indexOf("{ _id: false }", subSchemaStart);
  assert.ok(
    idFalseIdx > subSchemaStart,
    "productVariationSchema must declare { _id: false } — a sub-document that gets its own _id is a needless extra key on every stored variation",
  );
  const subSchemaBlock = src.slice(subSchemaStart, idFalseIdx);
  assert.match(
    subSchemaBlock,
    /name:\s*\{\s*type:\s*String,\s*required:\s*true,\s*trim:\s*true\s*\}/,
    "a variation's name must be required + trimmed — it is printed verbatim on the bill and the kitchen ticket",
  );
  assert.match(
    subSchemaBlock,
    /price:\s*\{\s*type:\s*Number,\s*required:\s*true,\s*min:\s*0\s*\}/,
    "a variation's price must be required and non-negative",
  );

  const fieldMatch = src.match(/\bvariations:\s*\{([^}]*)\}/);
  assert.ok(fieldMatch, "variations must be declared as a Schema field on productSchema");
  assert.match(
    fieldMatch[1],
    /default:\s*undefined/,
    "variations must declare `default: undefined` — Mongoose auto-materializes an array field to [] otherwise, and [] is still a PRESENT field: it would defeat the omit-empty story for the overwhelming majority of items that have none",
  );
  assert.match(fieldMatch[1], /type:\s*\[productVariationSchema\]/);
});

// The void CHOOSER is the one surface where two rows can be the same dish at
// different prices. Everything else about a void already carries the variation
// (the line key, the trail entry, the kitchen's VOID slip) — but if the list the
// operator picks FROM does not say the size, none of that helps: they pick blind.
test("PIN: VoidItemDialog names each fired line via orderItemLabel — on a tab holding two sizes of one dish, a raw item.name shows two identical rows and the wrong size (and the wrong money) comes off the bill", () => {
  const src = stripComments(readSrc(VOID_ITEM_DIALOG));

  assert.match(
    src,
    /import \{ orderItemLabel \} from "@pos\/shared\/utils";/,
    "VoidItemDialog must use the shared label helper, not its own formatting",
  );
  assert.match(
    src,
    /\{orderItemLabel\(item\)\} × \{item\.qty\}/,
    "the selectable row must name the line through orderItemLabel(item)",
  );
  // Mutation this catches: going back to the bare product name in the row the
  // operator actually taps.
  assert.ok(
    !/\{item\.name\} × \{item\.qty\}/.test(src),
    "the bare item.name must never be what identifies a voidable line",
  );
});

// The kitchen VOID slip is synthesized field-by-field from the trail entry rather
// than reusing the order line, so a new line field has to be added HERE too or the
// slip silently loses it. That is exactly what happened: the entry carried the
// variation (models + live leg both prove it) while the printed slip did not.
test("PIN: queueVoidSlip copies the voided line variation onto the synthesized print line — a VOID slip that says only the dish name cannot tell a cook WHICH size to stop making", () => {
  const src = stripComments(readSrc(USE_POS_PRINT));

  const start = src.indexOf("const queueVoidSlip");
  assert.ok(start >= 0, "queueVoidSlip must exist in usePosPrint");
  const end = src.indexOf("const reprintKot", start);
  assert.ok(end > start, "reprintKot must follow queueVoidSlip");
  const body = src.slice(start, end);

  assert.match(
    body,
    /variation: entry.variation,/,
    "the synthesized line must carry entry.variation through to KOTReceipt",
  );
});
