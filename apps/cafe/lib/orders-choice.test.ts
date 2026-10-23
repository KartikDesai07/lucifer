// U2 Task 5 (2026-10-23; fix round 1): the Orders page's chosen order as a pure model (lib/orders-choice.ts;
// docs/superpowers/specs/2026-10-23-orders-match-html-design.md 6.6, rulings P9 and P11, Review Focus 2): the first row
// taken only into an empty choice and only once the list has answered, dropped by a filter edit or a keystroke (the
// typed phone — never the debounced search landing), an auto-picked row giving way below 1280px, a tapped or engaged one
// staying. The page's use of it: lib/orders-detail-frame.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";

import { choiceKey, engageChoice, noChoice, settleChoice, tappedChoice } from "./orders-choice";
import { order } from "./orders-lanes.fixtures";

const K = choiceKey(0, "");

test("choiceKey (ruling P11): a filter edit or a keystroke changes it; the phone is read as typed (trimmed)", () => {
  assert.notEqual(choiceKey(1, ""), choiceKey(0, ""), "a filter edit (lane, date, payment, table, chip, Clear all / Reset)");
  assert.notEqual(choiceKey(0, "98"), choiceKey(0, "9"), "a keystroke in the phone search");
  assert.equal(choiceKey(0, " 98 "), choiceKey(0, "98"), "spaces around the typed phone are not a change");
  // The debounced phone is not part of the key: the search landing in the filters 350ms later leaves it as it was.
  assert.equal(choiceKey.length, 2, "the key reads the edits count and the typed phone only");
});

test("settleChoice: from 1280px an empty choice takes the first row shown (auto); below 1280px, with the width unknown, or before the list has answered, nothing is taken", () => {
  const first = order("1");
  assert.deepEqual(settleChoice(noChoice(K), K, true, first), { order: first, auto: true, key: K }, "the HTML's column shows the first row");
  for (const xl of [false, null]) {
    const empty = noChoice(K);
    assert.equal(settleChoice(empty, K, xl, first), empty, `xl=${xl}: nothing chosen until a row is tapped (same object: no store)`);
  }
  const empty = noChoice(K);
  assert.equal(settleChoice(empty, K, true, undefined), empty, "no first row (an empty list, or the list not answered yet: the page passes none)");
});

test("settleChoice: the auto-pick only fills an empty choice — a refresh with a new first row never swaps the order shown", () => {
  const held = settleChoice(noChoice(K), K, true, order("1"));
  assert.equal(settleChoice(held, K, true, order("9")), held, "a new order on top: the same choice (the same object)");
  const tapped = tappedChoice(order("5"), K);
  assert.equal(settleChoice(tapped, K, true, order("1")), tapped, "a tapped order is never replaced by the first row");
});

test("settleChoice (ruling P11): a keystroke drops the choice; the debounced search landing does not (the key stays)", () => {
  const typed = choiceKey(0, "9876");
  const tapped = tappedChoice(order("5"), typed);
  const keystroke = choiceKey(0, "98765");
  assert.deepEqual(settleChoice(tapped, keystroke, true, undefined), noChoice(keystroke), "a keystroke: dropped (no first row taken while the search is pending)");
  // 350ms later the debounced phone lands in the filters: the key is still the typed phone, so the tapped order (and a
  // payment opened from it) stays, whatever the new list's first row is.
  assert.equal(settleChoice(tapped, typed, true, order("7")), tapped, "the search landing: the same choice");
  const auto = settleChoice(noChoice(typed), typed, true, order("1"));
  assert.equal(settleChoice(auto, typed, true, order("7")), auto, "an auto-picked row is not swapped by the search landing either");
});

test("settleChoice: a filter edit drops the choice, then the next first row is taken", () => {
  const tapped = tappedChoice(order("5"), K);
  const edited = choiceKey(1, "");
  assert.deepEqual(settleChoice(tapped, edited, true, order("7")), { order: order("7"), auto: true, key: edited }, "from 1280px: the new list's first row");
  assert.deepEqual(settleChoice(tapped, edited, false, order("7")), noChoice(edited), "below 1280px: none (the sheet closes)");
  assert.deepEqual(settleChoice(tapped, edited, true, undefined), noChoice(edited), "an empty or pending new list: none");
});

test("tappedChoice under the latest key (the page's ref): a settle handed back after the search landed keeps the settled order", () => {
  // The page keys the choice on the typed phone and reads the latest key through a ref when a tap or a settle lands, so
  // a settle that finishes after the debounced search landed is stored under the key the next render settles with.
  const typed = choiceKey(0, "9876");
  const settled = order("5", { status: "Completed", paidAmount: 100, payment: "Cash" });
  const after = tappedChoice(settled, typed);
  assert.equal(settleChoice(after, typed, true, order("1")).order, settled, "the now-settled order stays shown (design 6.6)");
  assert.equal(settleChoice(tappedChoice(settled, choiceKey(0, "98")), typed, true, order("1")).order?._id, "1", "landmark: a stale key would drop it");
});

test("settleChoice (ruling P9): below 1280px an auto-picked row gives way (no full-screen sheet pops open); a tapped one stays chosen across the line", () => {
  const auto = settleChoice(noChoice(K), K, true, order("1"));
  assert.deepEqual(settleChoice(auto, K, false, order("1")), noChoice(K), "auto-picked, the window drops below 1280px: cleared");
  assert.equal(settleChoice(noChoice(K), K, true, order("2")).order?._id, "2", "back over 1280px: the first row shown then");
  const tapped = tappedChoice(order("5"), K);
  assert.equal(settleChoice(tapped, K, false, order("1")), tapped, "tapped: stays chosen below 1280px (the bottom sheet shows it)");
  assert.equal(settleChoice(tapped, K, true, order("1")), tapped, "and back over 1280px (the column shows it)");
});

test("engageChoice (Review Focus 2): a press or focus inside the detail makes an auto-picked order the operator's, so the payment it opened is never taken away below 1280px", () => {
  const auto = settleChoice(noChoice(K), K, true, order("1"));
  const engaged = engageChoice(auto);
  assert.deepEqual(engaged, { order: auto.order, auto: false, key: K }, "the same order, now the operator's");
  assert.equal(settleChoice(engaged, K, false, order("1")), engaged, "it stays chosen below 1280px");
  const tapped = tappedChoice(order("5"), K);
  assert.equal(engageChoice(tapped), tapped, "a tapped choice: unchanged (the same object: no store)");
  const none = noChoice(K);
  assert.equal(engageChoice(none), none, "no choice: unchanged");
});

test("settleChoice is settled: a settled choice settles to itself at every width (the page stores during render only when it changes)", () => {
  for (const xl of [true, false, null]) {
    for (const first of [order("1"), undefined]) {
      for (const start of [noChoice(K), tappedChoice(order("5"), K), settleChoice(noChoice(K), K, true, order("1")), noChoice(choiceKey(3, "9"))]) {
        const once = settleChoice(start, K, xl, first);
        assert.equal(settleChoice(once, K, xl, first), once, `xl=${xl}, first=${first?._id}: settling twice changes nothing`);
      }
    }
  }
});
