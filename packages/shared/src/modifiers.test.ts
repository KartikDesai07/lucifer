// "Modifiers come ticked" (UI batch 1 F, 2026-09-29): the shared contract —
// the one display formatter, the server's removals rule, the line identities
// that must tell a "NO Mushroom" pizza from a plain one, and the schemas that
// must carry the field (two of them are `.strict()`, where a missing key is a
// parse FAILURE, not a dropped field).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  orderItemModifierLines,
  removedModifiersError,
  REMOVED_MODIFIERS_NOT_ALLOWED_ERROR,
  REMOVED_MODIFIER_UNKNOWN_ERROR,
  REMOVED_MODIFIER_ALSO_ADDED_ERROR,
  REMOVED_MODIFIER_REPEATED_ERROR,
  orderLineKey,
  kotLineRef,
} from "./utils";
import { sameRoundItems } from "./order-idem";
import { orderItemSchema } from "./schemas/order.schema";
import { publicOrderItemSchema } from "./schemas/public-order.schema";
import { createProductSchema, updateProductSchema } from "./schemas/product.schema";
import { printOrderSnapshotItemSchema } from "./schemas/print-job.schema";

const PID = "65f0c2a1b2c3d4e5f6a7b8c9";

test("formatter: removals first as one NO line, additions as one + line, nothing for neither", () => {
  assert.deepEqual(orderItemModifierLines({ modifiers: [], removedModifiers: ["Mushroom"] }), ["NO Mushroom"]);
  assert.deepEqual(
    orderItemModifierLines({ modifiers: ["Extra cheese", "Olives"], removedModifiers: ["Mushroom", "Onion"] }),
    ["NO Mushroom, NO Onion", "+ Extra cheese, Olives"],
  );
  assert.deepEqual(orderItemModifierLines({ modifiers: [] }), []);
  assert.deepEqual(orderItemModifierLines({}), []);
});

test("formatter: an older line (additions only, no removals key) prints exactly today's '+ a, b'", () => {
  assert.deepEqual(orderItemModifierLines({ modifiers: ["Extra shot", "Oat milk"] }), ["+ Extra shot, Oat milk"]);
});

const PIZZA = { name: "Pizza", modifiers: ["Mushroom", "Onion", "Olives"], modifiersPreselected: true };

test("server rule: removals pass only on a ticked-by-default item, only its own modifiers, never also added", () => {
  assert.equal(removedModifiersError(PIZZA, { removedModifiers: ["Mushroom"] }), null);
  assert.equal(removedModifiersError(PIZZA, { modifiers: [], removedModifiers: ["Onion", "Olives"] }), null);
  assert.equal(
    removedModifiersError({ ...PIZZA, modifiersPreselected: undefined }, { removedModifiers: ["Mushroom"] }),
    REMOVED_MODIFIERS_NOT_ALLOWED_ERROR("Pizza"),
  );
  assert.equal(
    removedModifiersError({ ...PIZZA, modifiersPreselected: false }, { removedModifiers: ["Mushroom"] }),
    REMOVED_MODIFIERS_NOT_ALLOWED_ERROR("Pizza"),
  );
  assert.equal(removedModifiersError(PIZZA, { removedModifiers: ["Pineapple"] }), REMOVED_MODIFIER_UNKNOWN_ERROR("Pizza", "Pineapple"));
  // Exact compare, like variations: a case/space variant is not the same modifier.
  assert.equal(removedModifiersError(PIZZA, { removedModifiers: ["mushroom"] }), REMOVED_MODIFIER_UNKNOWN_ERROR("Pizza", "mushroom"));
  assert.equal(
    removedModifiersError(PIZZA, { modifiers: ["Mushroom"], removedModifiers: ["Mushroom"] }),
    REMOVED_MODIFIER_ALSO_ADDED_ERROR("Pizza", "Mushroom"),
  );
  assert.equal(
    removedModifiersError(PIZZA, { removedModifiers: ["Mushroom", "Mushroom"] }),
    REMOVED_MODIFIER_REPEATED_ERROR("Pizza", "Mushroom"),
  );
});

test("server rule: a line without removals always passes — normal mode and every older order are untouched", () => {
  assert.equal(removedModifiersError({ name: "Tea", modifiers: ["Sugar"] }, { modifiers: ["Sugar"] }), null);
  assert.equal(removedModifiersError({ name: "Tea" }, { removedModifiers: [] }), null);
  assert.equal(removedModifiersError({ name: "Tea" }, {}), null);
});

const LINE = { productId: PID, qty: 1, kotRound: 1, instructions: "", modifiers: [] as string[] };

test("identity: a line with no removals keeps its pre-feature key byte-for-byte (open tabs keep matching across the deploy)", () => {
  // The exact pre-feature format: fields joined by the record separator,
  // variation appended only when present.
  const RS = "\u001e";
  assert.equal(orderLineKey(LINE), [PID, 1, 1, "", ""].join(RS));
  assert.equal(orderLineKey({ ...LINE, removedModifiers: [] }), orderLineKey(LINE));
  assert.equal(orderLineKey({ ...LINE, variation: "Large" }), [PID, 1, 1, "", "", "Large"].join(RS));
  assert.equal(kotLineRef(LINE), [PID, 1, "", ""].join(RS));
  assert.equal(kotLineRef({ ...LINE, removedModifiers: [] }), kotLineRef(LINE));
});

test("identity: two pizzas that differ only in removals are different lines to a void and a kitchen tick", () => {
  const plain = { ...LINE };
  const noMushroom = { ...LINE, removedModifiers: ["Mushroom"] };
  assert.notEqual(orderLineKey(plain), orderLineKey(noMushroom));
  assert.notEqual(kotLineRef(plain), kotLineRef(noMushroom));
  // Removal order does not matter.
  assert.equal(
    orderLineKey({ ...LINE, removedModifiers: ["Onion", "Mushroom"] }),
    orderLineKey({ ...LINE, removedModifiers: ["Mushroom", "Onion"] }),
  );
  // A variation-only key can never equal a removals-only key with the same text.
  assert.notEqual(orderLineKey({ ...LINE, variation: "Mushroom" }), orderLineKey({ ...LINE, removedModifiers: ["Mushroom"] }));
  assert.notEqual(kotLineRef({ ...LINE, variation: "Mushroom" }), kotLineRef({ ...LINE, removedModifiers: ["Mushroom"] }));
});

test("replay compare: the same removals replay; different removals are a mismatch; no removals compare as before", () => {
  const sent = [{ productId: PID, qty: 1, removedModifiers: ["Mushroom"] }];
  const stored = [{ productId: PID, qty: 1, kotRound: 1, removedModifiers: ["Mushroom"] }];
  assert.equal(sameRoundItems(sent, stored, [], 1), true);
  assert.equal(sameRoundItems(sent, [{ productId: PID, qty: 1, kotRound: 1 }], [], 1), false);
  assert.equal(sameRoundItems([{ productId: PID, qty: 1 }], [{ productId: PID, qty: 1, kotRound: 1, removedModifiers: [] }], [], 1), true);
  // A voided "NO Mushroom" pizza between landing and the re-send still counts as sent.
  assert.equal(sameRoundItems(sent, [], [{ productId: PID, qty: 1, kotRound: 1, removedModifiers: ["Mushroom"] }], 1), true);
});

test("schemas: the order line, the diner's line (.strict) and the print snapshot line (.strict) all carry removedModifiers", () => {
  const item = { productId: PID, name: "Pizza", price: 300, qty: 1, modifiers: [], removedModifiers: ["Mushroom"] };
  const parsed = orderItemSchema.parse(item);
  assert.deepEqual(parsed.removedModifiers, ["Mushroom"]);
  // Absent stays absent (omit-empty) — no dead [] key on an ordinary line.
  const { removedModifiers: _omit, ...ordinary } = item;
  assert.deepEqual(_omit, ["Mushroom"], "landmark: the fixture had the key before it was taken off");
  assert.equal("removedModifiers" in orderItemSchema.parse(ordinary), false);

  const diner = publicOrderItemSchema.parse({ productId: PID, qty: 1, removedModifiers: ["Mushroom"] });
  assert.deepEqual(diner.removedModifiers, ["Mushroom"]);
  assert.equal(publicOrderItemSchema.safeParse({ productId: PID, qty: 1, removedModifiers: [""] }).success, false);

  const snap = { productId: PID, name: "Pizza", price: 300, qty: 1, modifiers: [], instructions: "", kotRound: 1 };
  assert.equal(printOrderSnapshotItemSchema.safeParse({ ...snap, removedModifiers: ["Mushroom"] }).success, true);
  assert.equal(printOrderSnapshotItemSchema.safeParse(snap).success, true);
});

test("schemas: the product flag is optional with no default — the CSV import (no column) can never switch it off", () => {
  const base = { name: "Pizza", categoryId: PID, price: 300 };
  assert.equal("modifiersPreselected" in createProductSchema.parse(base), false);
  assert.equal(createProductSchema.parse({ ...base, modifiersPreselected: true }).modifiersPreselected, true);
  assert.equal("modifiersPreselected" in updateProductSchema.parse({ price: 320 }), false);
  assert.equal(updateProductSchema.parse({ modifiersPreselected: false }).modifiersPreselected, false);
});
