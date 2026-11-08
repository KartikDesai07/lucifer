import { test } from "node:test";
import assert from "node:assert/strict";

import { navDecision, offlineNavMessage } from "@/lib/nav-decision";

const rows: Array<[boolean, boolean, boolean, "navigate" | "full-load" | "refuse"]> = [
  // offline, held, updatePending, answer
  [false, false, false, "navigate"],
  [false, false, true, "full-load"],
  [false, true, false, "navigate"],
  [false, true, true, "navigate"],
  [true, false, false, "refuse"],
  [true, false, true, "refuse"],
  [true, true, false, "navigate"],
  [true, true, true, "navigate"],
];

for (const [offline, held, updatePending, want] of rows) {
  test(`navDecision offline=${offline} held=${held} updatePending=${updatePending} -> ${want}`, () => {
    assert.equal(navDecision({ href: "/orders", offline, held, suspect: false, updatePending }), want, "the three-boolean table");
  });
}

// Post-verifier V1/V2: a suspect row (Next may keep a hard-load marker for it) is never left to Next: offline the toast,
// online our own document load through the print gate, whatever else is true.
for (const offline of [false, true]) {
  for (const held of [false, true]) {
    for (const updatePending of [false, true]) {
      const want = offline ? "refuse" : "full-load";
      test(`navDecision suspect offline=${offline} held=${held} updatePending=${updatePending} -> ${want}`, () => {
        assert.equal(navDecision({ href: "/orders", offline, held, suspect: true, updatePending }), want, "a suspect row: the toast offline, the gated load online");
      });
    }
  }
}

test("the refuse toast words are exact", () => {
  assert.equal(offlineNavMessage("Orders"), "Offline: Orders opens once the internet is back", "the owner's words");
});
