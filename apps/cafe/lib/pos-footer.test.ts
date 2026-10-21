// U1 Task 5 (2026-10-21): the /pos cart footer's links row (owner Q11; design 6.7; values 5.5 links): "Discount ·
// Promo code · Reward · Extra charge · Note". The first four open the one Bill options panel at their own section, Note
// opens the order note; an applied one names its value in place of its word, so nothing applied is ever hidden behind a
// tap (today's D9.8 rule, carried by the links now that the three-dot trigger is gone).
import { test } from "node:test";
import assert from "node:assert/strict";

import { footerLinkSelector, footerLinks, promoOffered, rewardOffered, rewardSectionShown, type FooterView } from "./pos-footer";

const NEW_ORDER: FooterView = {
  resuming: false,
  rewardOffered: false,
  discountRaw: 0,
  discountUnit: "₹",
  promoCode: null,
  rewardWorth: null,
  extraCount: 0,
  notes: "",
};

const words = (view: FooterView) => footerLinks(view).map((l) => l.applied ?? l.label);
const keys = (view: FooterView) => footerLinks(view).map((l) => l.key);
const linkOf = (view: FooterView, key: string) => footerLinks(view).find((l) => l.key === key);

test("a new order: Discount · Promo code · Extra charge · Note, nothing applied", () => {
  assert.deepEqual(keys(NEW_ORDER), ["discount", "promo", "charges", "note"], "the links in the design's order");
  assert.deepEqual(words(NEW_ORDER), ["Discount", "Promo code", "Extra charge", "Note"], "the words of a fresh sale");
  assert.ok(footerLinks(NEW_ORDER).every((l) => l.applied === null), "nothing applied on a fresh sale");
});

test("a resumed tab has no Note link (an add-round carries no order note, as today)", () => {
  const tab = { ...NEW_ORDER, resuming: true };
  assert.deepEqual(keys(tab), ["discount", "promo", "charges"], "a tab: no Note");
  assert.equal(linkOf({ ...tab, notes: "less spicy" }, "note"), undefined, "a typed note never brings the link back on a tab");
});

test("Reward shows only for a customer with stamps, rungs or cards, between Promo code and Extra charge", () => {
  assert.equal(linkOf(NEW_ORDER, "reward"), undefined, "no customer, or a customer with nothing to redeem: no Reward link");
  const offered = { ...NEW_ORDER, rewardOffered: true };
  assert.deepEqual(keys(offered), ["discount", "promo", "reward", "charges", "note"], "the Reward link in its place");
  assert.equal(linkOf(offered, "reward")?.label, "Reward", "its word");
  assert.equal(linkOf(offered, "reward")?.applied, null, "not applied until a rung or a card is picked");
});

test("rewardOffered is CartReward's own gate: a customer, and stamps, a rung or a card", () => {
  const none = { customerSelected: true, offers: 0, stamps: 0, cards: 0 };
  assert.equal(rewardOffered(none), false, "a customer with nothing to redeem");
  assert.equal(rewardOffered({ ...none, stamps: undefined }), false, "stamps still loading");
  assert.equal(rewardOffered({ ...none, offers: 2 }), true, "the ladder's rungs");
  assert.equal(rewardOffered({ ...none, stamps: 3 }), true, "stamps alone");
  assert.equal(rewardOffered({ ...none, cards: 1 }), true, "a scratch card alone");
  assert.equal(rewardOffered({ customerSelected: false, offers: 2, stamps: 3, cards: 1 }), false, "no customer, no reward");
});

test("the discount link names the entered discount: ₹, %, or the GST preset", () => {
  assert.equal(linkOf({ ...NEW_ORDER, discountRaw: 50, discountUnit: "₹" }, "discount")?.applied, "Discount · ₹50", "a rupee figure");
  assert.equal(linkOf({ ...NEW_ORDER, discountRaw: 1500, discountUnit: "₹" }, "discount")?.applied, "Discount · ₹1,500", "rupees in the Indian grouping");
  assert.equal(linkOf({ ...NEW_ORDER, discountRaw: 10, discountUnit: "%" }, "discount")?.applied, "Discount · 10%", "a percentage");
  assert.equal(linkOf({ ...NEW_ORDER, discountRaw: 7.5, discountUnit: "%" }, "discount")?.applied, "Discount · 7.5%", "a part percentage as typed");
  assert.equal(linkOf({ ...NEW_ORDER, discountUnit: "GST" }, "discount")?.applied, "GST Discount", "the GST preset (its amount is derived)");
  assert.equal(linkOf({ ...NEW_ORDER, discountRaw: 0, discountUnit: "%" }, "discount")?.applied, null, "a unit with no figure is not a discount");
});

test("the promo, reward and extra-charge links name what is applied", () => {
  assert.equal(linkOf({ ...NEW_ORDER, promoCode: "SAVE10" }, "promo")?.applied, "Promo · SAVE10", "the code");
  const reward = { ...NEW_ORDER, rewardOffered: true, rewardWorth: "₹50 off your bill" };
  assert.equal(linkOf(reward, "reward")?.applied, "Reward · ₹50 off your bill", "what the picked rung or card is worth");
  assert.equal(linkOf({ ...NEW_ORDER, extraCount: 2 }, "charges")?.applied, "Extra charge · 2", "how many extra charges");
  assert.equal(linkOf({ ...NEW_ORDER, extraCount: 1 }, "charges")?.applied, "Extra charge · 1", "one extra charge");
});

test("an applied reward keeps its link even when the customer's offers are gone, so it can be seen and removed", () => {
  const picked = { ...NEW_ORDER, rewardOffered: false, rewardWorth: "a free item" };
  assert.equal(linkOf(picked, "reward")?.applied, "Reward · a free item", "the picked reward still shows");
});

test("a picked reward hides the Promo code link until a code is set (CartPromo's own rule: one reward per bill)", () => {
  assert.equal(promoOffered({ rewardPicked: false, promoCode: null }), true, "free to type a code");
  assert.equal(promoOffered({ rewardPicked: true, promoCode: null }), false, "a reward is picked: the promo control stands down");
  assert.equal(promoOffered({ rewardPicked: true, promoCode: "SAVE10" }), true, "a code already set stays removable");
  const picked = { ...NEW_ORDER, rewardOffered: true, rewardWorth: "₹50 off your bill" };
  assert.equal(linkOf(picked, "promo"), undefined, "no Promo code link while a reward is picked");
  assert.equal(linkOf({ ...picked, promoCode: "SAVE10" }, "promo")?.applied, "Promo · SAVE10", "an applied code keeps its link");
});

test("the Note link previews the note: its first 24 characters, an ellipsis when longer", () => {
  assert.equal(linkOf({ ...NEW_ORDER, notes: "less spicy" }, "note")?.applied, "Note · less spicy", "a short note in full");
  assert.equal(
    linkOf({ ...NEW_ORDER, notes: "Birthday table, bring the cake out last" }, "note")?.applied,
    "Note · Birthday table, bring th…",
    "a long note cut at 24 characters",
  );
  assert.equal(linkOf({ ...NEW_ORDER, notes: "exactly twenty-four char" }, "note")?.applied, "Note · exactly twenty-four char", "24 characters: no ellipsis");
  assert.equal(linkOf({ ...NEW_ORDER, notes: "  no\n onion  " }, "note")?.applied, "Note · no onion", "spaces and line breaks fold to one space");
  assert.equal(linkOf({ ...NEW_ORDER, notes: "   " }, "note")?.applied, null, "a blank note is no note");
});

test("every link keeps its own word next to its applied text (the panel section it opens)", () => {
  const all = { ...NEW_ORDER, rewardOffered: true, discountRaw: 10, discountUnit: "%" as const, promoCode: "SAVE10", rewardWorth: null, extraCount: 2, notes: "x" };
  assert.deepEqual(
    footerLinks(all).map((l) => l.label),
    ["Discount", "Promo code", "Reward", "Extra charge", "Note"],
    "the words stay the section names",
  );
});

// U1 final fix wave (the Task 5 review's FIX BEFORE MERGE): the Reward link must never open a panel with no Reward
// section. The link shows while the customer has something to pick or a reward is picked (a tab's locked one too); the
// section shows then as well, and also for a tab whose reward is locked (today's locked line says so).
test("rewardSectionShown: offered, picked or locked; the Reward link never shows without its section", () => {
  assert.equal(rewardSectionShown({ offered: false, picked: false, locked: false }), false, "nothing to pick, nothing picked: no section");
  assert.equal(rewardSectionShown({ offered: true, picked: false, locked: false }), true, "something to pick");
  assert.equal(rewardSectionShown({ offered: false, picked: true, locked: true }), true, "a tab's reward whose rung left the ladder: the locked line");
  assert.equal(rewardSectionShown({ offered: false, picked: false, locked: true }), true, "a tab's card reward: the locked line");
  for (const offered of [false, true]) {
    for (const picked of [false, true]) {
      for (const locked of [false, true]) {
        const view = { ...NEW_ORDER, rewardOffered: offered, rewardWorth: picked ? "applied" : null };
        const link = linkOf(view, "reward") !== undefined;
        assert.ok(
          !link || rewardSectionShown({ offered, picked, locked }),
          `offered=${offered} picked=${picked} locked=${locked}: a Reward link opens a panel that has the Reward section`,
        );
      }
    }
  }
});

// U1 final fix wave: closing the Bill options or Note panel gives the focus back to the link that opened it.
test("footerLinkSelector: the visible cart's link for a section (or the note)", () => {
  assert.equal(footerLinkSelector("promo"), "[data-ui='pos-footer-link'][data-key='promo']", "the promo link");
  assert.equal(footerLinkSelector("note"), "[data-ui='pos-footer-link'][data-key='note']", "the note link");
});
