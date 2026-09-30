// UI batch 1 E + F (2026-09-29): square multi-select boxes, and "Modifiers
// come ticked" — the NO lines every surface must print the same way, the
// removals every writer must carry, and the server refusal both order write
// routes must run. Contract: .claude/plan/v2/_research/ui-batch-1-F-plan.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { buildKitchenRows, type FiredItem, type KitchenOrderInput } from "@/lib/kitchen-board";
import { checkItemRemovedModifiers } from "@/lib/variations";
import { cartItemFromOrderItem, cartItemToInput } from "@/hooks/use-cart";
import { billFromCart } from "@/components/public/public-bill-rows";
import { modifiersPreselectedToSave } from "@/components/products/ModifiersPreselectedField";
import { REMOVED_MODIFIERS_NOT_ALLOWED_ERROR, REMOVED_MODIFIER_UNKNOWN_ERROR } from "@pos/shared/utils";
import type { CartLine } from "@/components/public/public-cart-store";
import type { OrderItem } from "@/types";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(CAFE_ROOT, dir))) {
    const rel = path.join(dir, name);
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(path.join(CAFE_ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}

// ── E — multi-select = square ────────────────────────────────────────────────

test("PIN (E): every <Checkbox> in the app carries BRAND_CHECKBOX_SQUARE_CLASS — the --radius scale turns the stock box into a circle", () => {
  const importers = [...walk("app"), ...walk("components")]
    .filter((rel) => !rel.split(path.sep).includes("ui"))
    .filter((rel) => readSrc(rel).includes('from "@/components/ui/checkbox"'));
  // Vision guard: the four known importers are found (a scan that finds none proves nothing).
  assert.ok(importers.length >= 4, `expected >= 4 ui/checkbox importers, found ${importers.join(", ")}`);
  for (const rel of importers) {
    const src = stripComments(readSrc(rel));
    const tags = [...src.matchAll(/<Checkbox\b[\s\S]*?\/>/g)].map((m) => m[0]);
    assert.ok(tags.length > 0, `${rel}: landmark — it imports Checkbox, so it renders one`);
    for (const tag of tags) {
      assert.ok(tag.includes("className={BRAND_CHECKBOX_SQUARE_CLASS}"), `${rel}: a round multi-select box: ${tag}`);
    }
  }
  const classes = readSrc("components/brand/brand-classes.ts");
  const m = classes.match(/export const BRAND_CHECKBOX_SQUARE_CLASS = "([^"]*)";/);
  assert.ok(m, "landmark: the square class is a plain string");
  // A small fixed corner — never the radius scale that made it a circle.
  assert.match(m![1], /\brounded-\[\d+px\]/);
  assert.ok(!/rounded-(sm|md|lg|full)\b/.test(m![1]), "the square class must not use the --radius scale");
});

// ── F — one formatter on every surface ───────────────────────────────────────

const DISPLAY_SURFACES = [
  "components/pos/KOTReceipt.tsx",
  "components/pos/OrderReceipt.tsx",
  "components/pos/CartLine.tsx",
  "components/kitchen/KitchenLineCard.tsx",
  "components/orders/OrderDetailSheet.tsx",
  "components/orders/OrderRequestCard.tsx",
  "components/public/PublicCartLine.tsx",
  "components/public/PublicStatusItemRow.tsx",
  "components/public/public-bill-rows.ts",
  // Review finding 2026-09-29: the void picker and the void trail too — two
  // pizzas that differ only by "NO Mushroom" must not look alike there.
  "components/pos/VoidItemDialog.tsx",
  "components/orders/OrderVoidTrail.tsx",
];

test("PIN (F): every line-display surface prints modifiers through orderItemModifierLines — none joins them by hand", () => {
  for (const rel of DISPLAY_SURFACES) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /import \{[^}]*\borderItemModifierLines\b[^}]*\} from "@pos\/shared\/utils";/, `${rel}: imports the shared formatter`);
    assert.match(src, /\borderItemModifierLines\(/, `${rel}: calls it`);
    // Also the optional-chain form (item.modifiers?.join) a regression would idiomatically use.
    assert.ok(!/\bmodifiers\s*\??\.\s*join\s*\(/.test(src), `${rel}: a hand-written modifiers join is back — it would drop the NO lines`);
  }
});

test("PIN (F): both void slips (host print job and local print) carry the removals of the voided line", () => {
  for (const rel of ["lib/print-routing.ts", "hooks/use-pos-print.ts"]) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /modifiers: entry\.modifiers \?\? \[\],/, `${rel}: landmark — the void line lists its modifiers`);
    // The whole omit-empty guard, so a negated or always-false condition in front of the spread fails too.
    assert.match(
      src,
      /\.\.\.\(entry\.removedModifiers && entry\.removedModifiers\.length > 0\s*\?\s*\{ removedModifiers: entry\.removedModifiers \}\s*:\s*\{\}\)/,
      `${rel}: the void line must carry removedModifiers`,
    );
  }
});

test("PIN (F): both order write routes load the flag and refuse bad removals after the variation check, before anything is written", () => {
  for (const rel of ["app/api/orders/route.ts", "app/api/orders/[id]/items/route.ts"]) {
    const src = stripComments(readSrc(rel));
    assert.match(src, /\.select\("name variations modifiers modifiersPreselected price discount available isActive"\)/, `${rel}: the product read carries the flag`);
    const variations = src.indexOf("checkItemVariations(");
    const removals = src.indexOf("checkItemRemovedModifiers(");
    const refusal = src.indexOf("if (badRemovals) return failure(badRemovals, 400);");
    assert.ok(variations > 0 && removals > 0 && refusal > 0, `${rel}: landmarks present`);
    assert.equal(src.split("checkItemRemovedModifiers(").length - 1, 1, `${rel}: one removals check`);
    assert.ok(variations < removals && removals < refusal, `${rel}: removals checked after variations`);
    const firstWrite = Math.min(
      ...["Order.create(", "findOneAndUpdate(", "updateOne("].map((w) => src.indexOf(w)).filter((i) => i > 0),
    );
    assert.ok(Number.isFinite(firstWrite), `${rel}: landmark — the route writes somewhere`);
    assert.ok(refusal < firstWrite, `${rel}: the refusal must come before the first write`);
  }
});

// ── F — behaviour ────────────────────────────────────────────────────────────

const PID = "1".repeat(24);
const PIZZA = { _id: PID, name: "Pizza", modifiers: ["Mushroom", "Onion"], modifiersPreselected: true };

test("server check: a removal is refused on a normal item or for a modifier the item lacks; a missing product is ignored", () => {
  assert.equal(checkItemRemovedModifiers([PIZZA], [{ productId: PID, removedModifiers: ["Mushroom"] }]), null);
  assert.equal(
    checkItemRemovedModifiers([{ ...PIZZA, modifiersPreselected: undefined }], [{ productId: PID, removedModifiers: ["Mushroom"] }]),
    REMOVED_MODIFIERS_NOT_ALLOWED_ERROR("Pizza"),
  );
  assert.equal(
    checkItemRemovedModifiers([PIZZA], [{ productId: PID, removedModifiers: ["Olives"] }]),
    REMOVED_MODIFIER_UNKNOWN_ERROR("Pizza", "Olives"),
  );
  assert.equal(checkItemRemovedModifiers([], [{ productId: PID, removedModifiers: ["Olives"] }]), null);
  assert.equal(checkItemRemovedModifiers([PIZZA], [{ productId: PID, modifiers: [] }]), null);
});

const NOW = new Date("2026-09-29T12:00:00.000Z");
const fired = (over: Partial<FiredItem> = {}): FiredItem => ({ productId: PID, name: "Pizza", qty: 1, kotRound: 1, ...over });
const kOrder = (items: FiredItem[]): KitchenOrderInput => ({ _id: "a".repeat(24), orderId: "ORD-20260929-001", items, createdAt: NOW });

test("kitchen: a NO Mushroom pizza is its own row (and its own tick) beside a plain pizza of the same round", () => {
  const rows = buildKitchenRows({ orders: [kOrder([fired(), fired({ removedModifiers: ["Mushroom"] })])], ticksByOrder: {}, now: NOW });
  assert.equal(rows.length, 2, "the two pizzas must not collapse into one row");
  const removal = rows.find((r) => r.removedModifiers?.length);
  assert.deepEqual(removal?.removedModifiers, ["Mushroom"]);
  assert.notEqual(rows[0].ref, rows[1].ref);
  const plain = rows.find((r) => !r.removedModifiers);
  assert.ok(plain, "the plain pizza's row carries no removals key (omit-empty)");
});

const orderItem = (over: Partial<OrderItem> = {}): OrderItem => ({
  productId: PID, name: "Pizza", price: 300, qty: 1, modifiers: [], instructions: "", kotRound: 1, ...over,
});

test("cart: removals survive the cart round trip into the send payload; a line without them sends no key", () => {
  const withRemoval = cartItemFromOrderItem(orderItem({ removedModifiers: ["Mushroom"] }), 0);
  assert.deepEqual(cartItemToInput(withRemoval).removedModifiers, ["Mushroom"]);
  const plain = cartItemFromOrderItem(orderItem(), 1);
  assert.equal("removedModifiers" in cartItemToInput(plain), false);
  // Different lines to the cart too.
  assert.notEqual(withRemoval.lineId.replace(/^#\d+:/, ""), plain.lineId.replace(/^#\d+:/, ""));
});

test("diner bill: the sub line shows NO Mushroom, and an older line keeps its modifiers", () => {
  const line = (over: Partial<CartLine>): CartLine =>
    ({ lineId: "x", productId: PID, name: "Pizza", price: 300, qty: 1, modifiers: [], ...over }) as CartLine;
  const bill = billFromCart([line({ removedModifiers: ["Mushroom"] }), line({ modifiers: ["Cheese"] })], 600, null, 0, 0, 600);
  assert.equal(bill.lines[0].sub, "NO Mushroom");
  assert.equal(bill.lines[1].sub, "+ Cheese");
});

test("product form: the flag always saves as a boolean, and never true for an item with no modifiers", () => {
  assert.equal(modifiersPreselectedToSave({ modifiers: ["Mushroom"], modifiersPreselected: true }), true);
  assert.equal(modifiersPreselectedToSave({ modifiers: ["Mushroom"], modifiersPreselected: false }), false);
  assert.equal(modifiersPreselectedToSave({ modifiers: ["Mushroom"] }), false);
  assert.equal(modifiersPreselectedToSave({ modifiers: [], modifiersPreselected: true }), false);
});

// ── Review round (2026-09-29): every remaining carry point, behaviourally ────

import { printOrderSnapshot } from "@pos/shared/print-job";
import { priceRequestItems, type PricedProductSource } from "@/lib/public-pricing";
import { toStatusItems } from "@/lib/order-request-edit";
import { buildStatusPatchBody, seedDraft } from "@/components/public/public-status-edit";
import { buildOrderRequestBody } from "@/components/public/public-submit";
import { buildRepeatCart, lineKey as dinerLineKey } from "@/components/public/public-cart-math";
import { createPublicOrderRequestSchema } from "@pos/shared/schemas/public-order.schema";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import type { IOrderRequestItem } from "@/models/OrderRequest";
import type { Order } from "@/types";

test("host print snapshot: a NO Mushroom line keeps its removals; a plain line carries no key (the snapshot is hashed)", () => {
  const order = {
    _id: "o1", orderId: "ORD-1", customerName: "Walk-In", subtotal: 340, discount: 0, gstAmount: 0, total: 340, paidAmount: 0,
    payment: "Unpaid", status: "Pending", receiver: "Admin", createdAt: "2026-09-29T00:00:00.000Z",
    items: [orderItem({ removedModifiers: ["Mushroom"] }), orderItem({ name: "Tea", price: 40 })],
  } as unknown as Order;
  const snap = printOrderSnapshot(order);
  assert.deepEqual(snap.items[0].removedModifiers, ["Mushroom"]);
  assert.equal("removedModifiers" in snap.items[1], false);
});

test("public gate: the priced line carries the removal on a flagged item and the gate refuses it on a normal one", () => {
  const products: PricedProductSource[] = [
    { _id: PID, name: "Pizza", price: 300, discount: 0, available: true, modifiers: ["Mushroom", "Onion"], modifiersPreselected: true },
    { _id: "2".repeat(24), name: "Tea", price: 40, discount: 0, available: true, modifiers: ["Sugar"] },
  ];
  const ok = priceRequestItems(products, [{ productId: PID, modifiers: [], removedModifiers: ["Mushroom"], qty: 1 }]);
  assert.ok(!("error" in ok) && ok.lines[0].removedModifiers?.[0] === "Mushroom");
  const plain = priceRequestItems(products, [{ productId: PID, modifiers: [], qty: 1 }]);
  assert.ok(!("error" in plain) && !("removedModifiers" in plain.lines[0]), "no removals, no key");
  const refused = priceRequestItems(products, [{ productId: "2".repeat(24), modifiers: [], removedModifiers: ["Sugar"], qty: 1 }]);
  assert.deepEqual(refused, { error: REMOVED_MODIFIERS_NOT_ALLOWED_ERROR("Tea") });
});

test("diner round trip: status rows, the edit PATCH body and the order POST body all carry the removals (and the strict schema accepts them)", () => {
  const stored = [{ productId: PID, name: "Pizza", price: 300, qty: 1, modifiers: [], removedModifiers: ["Mushroom"], instructions: "" }];
  const rows = toStatusItems(stored as unknown as IOrderRequestItem[]);
  assert.deepEqual(rows[0].removedModifiers, ["Mushroom"]);
  const patch = buildStatusPatchBody({ draft: seedDraft(rows), noteDraft: "", promoDraft: null, promoSeed: null });
  assert.deepEqual(patch.items[0].removedModifiers, ["Mushroom"]);
  const cartLine = { lineId: "x", productId: PID, name: "Pizza", price: 300, qty: 1, modifiers: [], removedModifiers: ["Mushroom"] } as unknown as CartLine;
  const body = buildOrderRequestBody({ target: { kind: "parcel" }, cart: [cartLine], note: "", promoCode: null, name: "Asha", mobile: "9876543210", requestedRewardAt: null });
  assert.deepEqual(body.items[0].removedModifiers, ["Mushroom"]);
  const parsed = createPublicOrderRequestSchema.safeParse(body);
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

const menuPizza = (over: Partial<PublicMenuProduct> = {}): PublicMenuProduct =>
  ({ id: PID, name: "Pizza", category: "Mains", price: 300, discount: 0, available: true, image: "", modifiers: ["Mushroom", "Onion"], modifiersPreselected: true, ...over }) as PublicMenuProduct;

test("'Order this again': NO Mushroom repeats as NO Mushroom; if the item no longer allows it the line is skipped, never repeated with the mushroom back on", () => {
  const past = [{ productId: PID, qty: 1, modifiers: [], removedModifiers: ["Mushroom"] }];
  const again = buildRepeatCart([], past, [menuPizza()]);
  assert.equal(again.added, 1);
  assert.deepEqual(again.next[0].removedModifiers, ["Mushroom"]);
  const flagOff = buildRepeatCart([], past, [menuPizza({ modifiersPreselected: undefined })]);
  assert.deepEqual([flagOff.added, flagOff.skipped, flagOff.next.length], [0, 1, 0]);
  const modifierGone = buildRepeatCart([], past, [menuPizza({ modifiers: ["Onion"] })]);
  assert.deepEqual([modifierGone.added, modifierGone.skipped], [0, 1]);
  // A plain past line still repeats exactly as before.
  const plain = buildRepeatCart([], [{ productId: PID, qty: 2, modifiers: [] }], [menuPizza()]);
  assert.equal(plain.next[0].qty, 2);
  assert.equal("removedModifiers" in plain.next[0], false);
});

test("diner cart key: no free-text note can forge a removal (the removals sit behind an untypeable separator)", () => {
  assert.notEqual(dinerLineKey(PID, undefined, [], "less salt|Mushroom"), dinerLineKey(PID, undefined, [], "less salt", ["Mushroom"]));
  assert.equal(dinerLineKey(PID, undefined, [], "less salt", []), dinerLineKey(PID, undefined, [], "less salt"), "no removals = the pre-feature key");
});

test("PIN (F): accepting a diner request mints Order lines that keep the removals (omit-empty)", () => {
  const src = stripComments(readSrc("lib/order-request-accept.ts"));
  const map = src.match(/const items = request\.items\.map\(\(it\) => \(\{([\s\S]*?)\}\)\);/);
  assert.ok(map, "landmark: the stored-request → Order items map");
  assert.match(map![1], /modifiers: it\.modifiers,/, "landmark: the map lists modifiers");
  assert.match(
    map![1],
    /\.\.\.\(it\.removedModifiers && it\.removedModifiers\.length > 0\s*\?\s*\{ removedModifiers: it\.removedModifiers \}\s*:\s*\{\}\)/,
    "the accepted Order line must keep NO Mushroom",
  );
});

test("POS cart key: removals sit behind the untypeable separator (same as the diner cart); a plain line keeps the pre-feature key", () => {
  // In the POS key the variation slot follows the free text, so a "|" was not
  // forgeable there — the separator is defence in depth, pinned directly.
  const RECORD_SEP = "\u001e";
  const noted = cartItemFromOrderItem(orderItem({ instructions: "less salt|Mushroom", kotRound: 0 }), 0);
  const removal = cartItemFromOrderItem(orderItem({ instructions: "less salt", removedModifiers: ["Mushroom"], kotRound: 0 }), 0);
  assert.notEqual(noted.lineId, removal.lineId);
  assert.ok(removal.lineId.endsWith(`${RECORD_SEP}Mushroom`), "the removals follow the record separator");
  assert.ok(!noted.lineId.includes(RECORD_SEP), "a line without removals has no separator — its key is byte-identical to before");
});
