import { test } from "node:test";
import assert from "node:assert/strict";
import { orderLineKey } from "@pos/shared/utils";

// CR1.3 — `orderLineKey` (packages/shared/src/utils.ts) is the STABLE IDENTITY
// of one order line, and the entire fix for the review-confirmed wrong-line-void
// bug rests on it discriminating every field a void request cares about, while
// staying insensitive to modifier ORDER, and never letting free text in
// instructions/modifiers forge a field boundary (the join separators are ASCII
// control-character escapes, not printable text a cashier could type). This
// file pins the function's identity properties directly; order-void.test.ts
// pins the CONSUMER behavior (the wrong-line rejection) that depends on them.

const BASE = { productId: "p1", qty: 1, kotRound: 1 };

test("orderLineKey: identical input produces the identical key (sanity baseline for every equality check below)", () => {
  assert.equal(orderLineKey({ ...BASE }), orderLineKey({ ...BASE }));
});

test("orderLineKey: same product/qty/round but different instructions -> different keys", () => {
  const a = orderLineKey({ ...BASE, instructions: "less sugar" });
  const b = orderLineKey({ ...BASE, instructions: "extra hot" });
  assert.notEqual(a, b, "two covers of the same dish prepared differently are DIFFERENT lines");
});

test("orderLineKey: same product/qty/round but different modifiers -> different keys", () => {
  const a = orderLineKey({ ...BASE, modifiers: ["no onion"] });
  const b = orderLineKey({ ...BASE, modifiers: ["extra cheese"] });
  assert.notEqual(a, b);
});

test("orderLineKey: different kotRound -> different keys", () => {
  const a = orderLineKey({ ...BASE, kotRound: 1 });
  const b = orderLineKey({ ...BASE, kotRound: 2 });
  assert.notEqual(
    a,
    b,
    "a concurrent re-fire/qty-reduce that changes the round must invalidate the operator's stale view",
  );
});

test("orderLineKey: different qty -> different keys", () => {
  const a = orderLineKey({ ...BASE, qty: 1 });
  const b = orderLineKey({ ...BASE, qty: 2 });
  assert.notEqual(
    a,
    b,
    "a concurrent qty-reduce changes the line's qty, which must also invalidate a stale view of it",
  );
});

test("orderLineKey: different productId -> different keys", () => {
  const a = orderLineKey({ ...BASE, productId: "p1" });
  const b = orderLineKey({ ...BASE, productId: "p2" });
  assert.notEqual(a, b);
});

test("orderLineKey: a re-ordered modifiers array is the SAME key — sorted before joining", () => {
  const a = orderLineKey({ ...BASE, modifiers: ["no onion", "extra cheese"] });
  const b = orderLineKey({ ...BASE, modifiers: ["extra cheese", "no onion"] });
  assert.equal(a, b, "modifier order is not part of a line's identity — the cart may re-list them in any order");
});

// ── Free text cannot forge a field boundary ──────────────────────────────────
// If the join separator were an ordinary printable character (the doc comment's
// own example is "|"), a cashier's free text could make two DIFFERENT lines
// collide onto the SAME key. The real separators are ASCII record/unit-separator
// control bytes (\u001e / \u001f) that no text input can produce, so this must
// never happen — pinned here as an explicit behavioral guarantee, not just a
// comment: if a future edit ever "simplifies" the separator to "|", this fails.

test("orderLineKey: a '|' inside instructions cannot forge the boundary between instructions and modifiers", () => {
  // If '|' were the join separator, both of these would serialize to the exact
  // same joined string ("...no ice|extra hot...") despite describing two
  // different lines: one item with a single instruction string, and another
  // with a shorter instruction plus a separate modifier.
  const pipeInsideInstructions = orderLineKey({
    ...BASE,
    instructions: "no ice|extra hot",
    modifiers: [],
  });
  const splitAcrossRealFields = orderLineKey({
    ...BASE,
    instructions: "no ice",
    modifiers: ["extra hot"],
  });
  assert.notEqual(
    pipeInsideInstructions,
    splitAcrossRealFields,
    "'|' in free text must not collide with a genuinely different instructions/modifiers split",
  );
});

test("orderLineKey: the literal six characters \"\\u001f\" typed into instructions cannot forge the real modifier separator", () => {
  // A cashier can only ever type the visible characters \, u, 0, 0, 1, f — never
  // the actual U+001F control byte the code joins modifiers with — so this must
  // not collide with a line whose modifiers genuinely contain that control byte
  // as a join boundary.
  const literalBackslashText = orderLineKey({
    ...BASE,
    instructions: "before\\u001fafter",
    modifiers: [],
  });
  const realControlByteBoundary = orderLineKey({
    ...BASE,
    instructions: "",
    modifiers: ["before", "after"],
  });
  assert.notEqual(
    literalBackslashText,
    realControlByteBoundary,
    "typed-out escape text is not the same byte as the real separator — must never collide",
  );
});
