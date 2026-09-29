import { test } from "node:test";
import assert from "node:assert/strict";

import { modifiersPreselectedFor, initialSelected, pickModifierResult } from "@/lib/modifier-picker";

const FLAGGED = { modifiersPreselected: true, modifiers: ["Mushroom", "Onion", "Olives"] };
const NORMAL = { modifiersPreselected: false, modifiers: ["Extra shot", "Oat milk"] };
const FLAGGED_NO_MODIFIERS = { modifiersPreselected: true, modifiers: [] as string[] };
const UNFLAGGED_UNDEFINED = { modifiers: ["Sugar"] };

test("modifiersPreselectedFor: only true AND at least one modifier turns reverse mode on", () => {
  assert.equal(modifiersPreselectedFor(FLAGGED), true);
  assert.equal(modifiersPreselectedFor(NORMAL), false);
  assert.equal(modifiersPreselectedFor(FLAGGED_NO_MODIFIERS), false);
  assert.equal(modifiersPreselectedFor(UNFLAGGED_UNDEFINED), false);
});

test("initialSelected: reverse mode starts every modifier ticked; normal mode starts with none", () => {
  assert.deepEqual(initialSelected(FLAGGED), ["Mushroom", "Onion", "Olives"]);
  assert.deepEqual(initialSelected(NORMAL), []);
  assert.deepEqual(initialSelected(FLAGGED_NO_MODIFIERS), []);
});

test("pickModifierResult: normal mode — modifiers is exactly what's ticked, no removedModifiers ever", () => {
  assert.deepEqual(pickModifierResult(NORMAL, ["Extra shot"]), { modifiers: ["Extra shot"] });
  assert.deepEqual(pickModifierResult(NORMAL, []), { modifiers: [] });
});

test("pickModifierResult: reverse mode — modifiers always empty, unticked ones become removedModifiers", () => {
  assert.deepEqual(pickModifierResult(FLAGGED, ["Mushroom", "Onion", "Olives"]), { modifiers: [] });
  assert.deepEqual(pickModifierResult(FLAGGED, ["Onion"]), {
    modifiers: [],
    removedModifiers: ["Mushroom", "Olives"],
  });
  assert.deepEqual(pickModifierResult(FLAGGED, []), {
    modifiers: [],
    removedModifiers: ["Mushroom", "Onion", "Olives"],
  });
});

test("pickModifierResult: a flagged product with no modifiers behaves like normal mode (nothing to preselect)", () => {
  assert.deepEqual(pickModifierResult(FLAGGED_NO_MODIFIERS, []), { modifiers: [] });
});

test("reverse mode: an item whose list names a modifier twice still sends that removal ONCE (the server refuses repeats)", () => {
  const product = { modifiersPreselected: true, modifiers: ["Mushroom", "Onion", "Mushroom"] };
  assert.deepEqual(pickModifierResult(product, ["Onion"]), { modifiers: [], removedModifiers: ["Mushroom"] });
});
