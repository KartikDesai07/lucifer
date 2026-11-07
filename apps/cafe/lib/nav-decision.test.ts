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
    assert.equal(navDecision({ href: "/orders", offline, held, updatePending }), want, "the three-boolean table");
  });
}

test("the refuse toast words are exact", () => {
  assert.equal(offlineNavMessage("Orders"), "Offline: Orders opens once the internet is back", "the owner's words");
});
