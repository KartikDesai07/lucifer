// U6 Task 3 (2026-11-03): the Reservations page's chosen booking as a pure model (lib/reservations-choice.ts; design B5 =
// U2's lib/orders-choice.ts on booking ids): the first listed row taken once from 1280px, kept across a list refresh,
// dropped by a key change (a day / tab / search edit or a keystroke), an auto pick giving way below 1280px, a pressed one
// staying, a press or focus inside the detail making an auto pick the operator's.
import { test } from "node:test";
import assert from "node:assert/strict";

import { engageResChoice, noResChoice, resChoiceKey, settleResChoice, tappedResChoice } from "./reservations-choice";

const K = resChoiceKey(0, "");

test("resChoiceKey: a filter edit or a keystroke changes it; the typed query is read trimmed", () => {
  assert.notEqual(resChoiceKey(1, ""), resChoiceKey(0, ""), "a day / Today / calendar / tab edit");
  assert.notEqual(resChoiceKey(0, "ro"), resChoiceKey(0, "r"), "a keystroke in the search");
  assert.equal(resChoiceKey(0, " ro "), resChoiceKey(0, "ro"), "spaces around the query are not a change");
});

test("settleResChoice: from 1280px an empty choice takes the first row (auto); below 1280px, with the width unknown, or with no first row, nothing", () => {
  assert.deepEqual(settleResChoice(noResChoice(K), K, true, "a1"), { id: "a1", auto: true, key: K }, "the HTML's dock shows the first row");
  for (const xl of [false, null]) {
    const empty = noResChoice(K);
    assert.equal(settleResChoice(empty, K, xl, "a1"), empty, `xl=${xl}: nothing until a row is pressed (same object: no store)`);
  }
  const empty = noResChoice(K);
  assert.equal(settleResChoice(empty, K, true, undefined), empty, "an empty or unanswered list: the page passes none");
});

test("settleResChoice: the auto pick fills an empty choice only; a refresh with a new first row never swaps it, a pressed one stays", () => {
  const held = settleResChoice(noResChoice(K), K, true, "a1");
  assert.equal(settleResChoice(held, K, true, "b2"), held, "a new first row: the same choice (the same object)");
  const tapped = tappedResChoice("c3", K);
  assert.equal(settleResChoice(tapped, K, true, "a1"), tapped, "a pressed booking is never replaced by the first row");
});

test("settleResChoice: a key change drops the choice, then the next first row is taken (from 1280px) or none", () => {
  const tapped = tappedResChoice("c3", K);
  const edited = resChoiceKey(1, "");
  assert.deepEqual(settleResChoice(tapped, edited, true, "d4"), { id: "d4", auto: true, key: edited }, "from 1280px: the new first row");
  assert.deepEqual(settleResChoice(tapped, edited, false, "d4"), noResChoice(edited), "below 1280px: none (the sheet closes)");
  assert.deepEqual(settleResChoice(tapped, edited, true, undefined), noResChoice(edited), "an empty new list: none");
  const typed = resChoiceKey(0, "ro");
  assert.deepEqual(settleResChoice(tappedResChoice("c3", K), typed, true, undefined), noResChoice(typed), "a keystroke drops it too");
});

test("settleResChoice: an auto pick gives way below 1280px (a rotated tablet never pops the sheet open); a pressed one stays across the line", () => {
  const auto = settleResChoice(noResChoice(K), K, true, "a1");
  assert.deepEqual(settleResChoice(auto, K, false, "a1"), noResChoice(K), "auto + below 1280px: cleared");
  const tapped = tappedResChoice("c3", K);
  assert.equal(settleResChoice(tapped, K, false, "a1"), tapped, "pressed + below 1280px: stays");
  assert.equal(settleResChoice(auto, K, null, "a1"), auto, "the width not known yet: the auto pick is not cleared");
  const settled = settleResChoice(tapped, K, true, "a1");
  assert.equal(settleResChoice(settled, K, true, "a1"), settled, "a settled choice settles to itself (the page stores only a change)");
});

test("tappedResChoice / engageResChoice: a press or focus inside the detail makes an auto pick the operator's", () => {
  assert.deepEqual(tappedResChoice(null, K), { id: null, auto: false, key: K }, "a close: nothing chosen, not auto");
  const auto = settleResChoice(noResChoice(K), K, true, "a1");
  assert.deepEqual(engageResChoice(auto), { id: "a1", auto: false, key: K }, "engaged: kept below 1280px");
  const tapped = tappedResChoice("c3", K);
  assert.equal(engageResChoice(tapped), tapped, "already the operator's: the same object");
  assert.deepEqual(settleResChoice(engageResChoice(auto), K, false, "a1"), { id: "a1", auto: false, key: K }, "an engaged pick survives the 1280 line");
});
