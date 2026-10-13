import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ONE_REWARD_PER_BILL } from "@pos/shared/reward-card-use";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { POINTS_NEED_CUSTOMER, POINTS_REWARD_EXCLUSIVE, pointsRedeemedReward } from "@pos/shared/reward-points";
import { computeOrderTotals, type GstConfig } from "@/lib/receipt";
import { usePosTotals } from "@/hooks/use-pos-totals";
import { usePosModalTotals, type PosModalTotals } from "@/hooks/use-pos-modal-totals";
import {
  POINTS_BLOCK_DISCOUNT,
  POINTS_BLOCK_FROZEN,
  pointsRowState,
  type PointsRowInput,
} from "./settle-points-view";
import type { Order, Settings } from "@/types";

// CB-7 S6 slice C — the settle popup's points row: the pure state (who may spend what, and why not) and the one
// behavioural pin that matters for money: the screen's preview prices points with the SAME function the server uses.

const FREE: PointsRowInput = {
  hasCustomer: true,
  balance: 80,
  subtotal: 500,
  resumed: null,
  promo: false,
  rewardPending: false,
  manualDiscount: false,
  frozen: false,
};
const row = (over: Partial<PointsRowInput>) => pointsRowState({ ...FREE, ...over });

test("pointsRowState: a free bill offers ALL usable points, up to the food total (owner O3)", () => {
  assert.deepEqual(row({}), { usable: true, amount: 80, reason: null });
  assert.deepEqual(row({ balance: 800 }), { usable: true, amount: 500, reason: null }, "capped at the food total");
  assert.deepEqual(row({ balance: 80.9, subtotal: 500.4 }), { usable: true, amount: 80, reason: null }, "whole points only");
});

test("pointsRowState: nothing to offer shows nothing (no reason, not usable) — balance 0, unknown, or an empty bill", () => {
  const none = { usable: false, amount: 0, reason: null };
  assert.deepEqual(row({ balance: 0 }), none);
  assert.deepEqual(row({ balance: undefined }), none, "still loading");
  assert.deepEqual(row({ subtotal: 0 }), none);
});

test("pointsRowState: every blocker says why, in plain English, and offers nothing", () => {
  const blocked = (reason: string) => ({ usable: false, amount: 0, reason });
  assert.deepEqual(row({ hasCustomer: false, balance: undefined }), blocked(POINTS_NEED_CUSTOMER));
  assert.deepEqual(row({ resumed: { rewardAt: 10 } }), blocked(ONE_REWARD_PER_BILL), "a stamp reward is already on the tab");
  assert.deepEqual(row({ resumed: { rewardCardId: "c1" } }), blocked(ONE_REWARD_PER_BILL), "a card reward is already on the tab");
  assert.deepEqual(row({ resumed: { discountKind: "reward" } }), blocked(ONE_REWARD_PER_BILL));
  assert.deepEqual(row({ resumed: { rewardPoints: 20 } }), blocked(ONE_REWARD_PER_BILL), "points already spent on the tab");
  assert.deepEqual(row({ promo: true }), blocked(PROMO_BLOCKS_REWARD));
  assert.deepEqual(row({ rewardPending: true }), blocked(POINTS_REWARD_EXCLUSIVE), "a stamp rung or card is picked");
  assert.deepEqual(row({ manualDiscount: true }), blocked(POINTS_BLOCK_DISCOUNT));
});

test("pointsRowState: a blocker is not shown to someone with no points to spend", () => {
  assert.deepEqual(row({ balance: 0, promo: true }), { usable: false, amount: 0, reason: null });
});

test("pointsRowState: a frozen send keeps the offer (so a replay shows what it sent) but cannot be toggled", () => {
  assert.deepEqual(row({ frozen: true }), { usable: false, amount: 80, reason: POINTS_BLOCK_FROZEN });
});

test("pointsRowState: a plain tab without a reward never trips the one-reward block", () => {
  assert.deepEqual(row({ resumed: { rewardAt: undefined } }), { usable: true, amount: 80, reason: null });
});

// ── the behavioural pin: preview == server price (GST off, exclusive, inclusive) ───────────────────────────────

const ITEMS = [
  { price: 250, qty: 2 },
  { price: 99, qty: 3 },
];
const SUBTOTAL = 797;
const CONFIGS: [string, GstConfig][] = [
  ["GST off", { gstEnabled: false, gstRate: 0, gstMode: "inclusive" }],
  ["GST exclusive", { gstEnabled: true, gstRate: 5, gstMode: "exclusive" }],
  ["GST inclusive", { gstEnabled: true, gstRate: 5, gstMode: "inclusive" }],
];
const settingsOf = (c: GstConfig) => ({ gstEnabled: c.gstEnabled, gstRate: c.gstRate, gstMode: c.gstMode }) as Settings;

// Runs a hook the way React would (one server render), returning what it returned.
function probe<T>(run: () => T): T {
  let out: T | undefined;
  const Probe = () => {
    out = run();
    return null;
  };
  renderToStaticMarkup(createElement(Probe));
  assert.ok(out !== undefined, "the hook ran");
  return out;
}

for (const [name, cfg] of CONFIGS) {
  for (const n of [1, 120, SUBTOTAL, 5000]) {
    test(`PIN: the preview prices ${n} points exactly as the server does — ${name}`, () => {
      const reward = pointsRedeemedReward(Math.min(n, SUBTOTAL));
      const items = ITEMS.map((i) => ({ ...i, name: "x", productId: "p" }));
      // The server's settle: the stored items, discountKind "reward", the points reward.
      const server = computeOrderTotals({ items: items as never, discount: 0, discountKind: "reward", charge: 30, cfg, reward });

      // The cart's live preview (usePosTotals) with the points reward.
      const cart = probe(() =>
        usePosTotals({ subtotal: SUBTOTAL, discountRaw: 0, discountUnit: "₹", charge: 30, settings: settingsOf(cfg), reward }),
      );
      assert.equal(cart.discount, server.discount, "cart discount");
      assert.equal(cart.gstAmount, server.gstAmount, "cart GST");
      assert.equal(cart.total, server.total, "cart total");

      // The settle popup's totals (usePosModalTotals) re-derive against the tab's snapshot.
      const tab = {
        _id: "t1", items, discount: 0, gstRate: cfg.gstRate, gstMode: cfg.gstMode, chargeAmount: 30,
        charges: [{ type: "table", label: "Table", amount: 30 }],
      } as unknown as Order;
      const modal: PosModalTotals = probe(() =>
        usePosModalTotals({
          resumedOrder: tab, discount: cart.discount, discountKind: undefined, chargeOverride: undefined, charge: 30,
          chargeLabel: "Table", extraCharges: [], settings: settingsOf(cfg), paymentIntent: "settle", subtotal: SUBTOTAL,
          gstAmount: cart.gstAmount, gstRate: cart.gstRate, total: cart.total, count: 5, reward,
        }),
      );
      assert.equal(modal.discount, server.discount, "popup discount");
      assert.equal(modal.gstAmount, server.gstAmount, "popup GST");
      assert.equal(modal.total, server.total, "popup total");
      assert.equal(modal.discountKind, "reward", "the bill line reads Reward (owner O1)");
    });
  }
}

test("PIN: with no points the settle popup prices exactly as before (the manual discount rides, no kind)", () => {
  const cfg = CONFIGS[1][1];
  const items = ITEMS.map((i) => ({ ...i, name: "x", productId: "p" }));
  const tab = { _id: "t1", items, discount: 0, gstRate: cfg.gstRate, gstMode: cfg.gstMode } as unknown as Order;
  const modal = probe(() =>
    usePosModalTotals({
      resumedOrder: tab, discount: 50, discountKind: undefined, chargeOverride: undefined, charge: 0, chargeLabel: "",
      extraCharges: [], settings: settingsOf(cfg), paymentIntent: "settle", subtotal: SUBTOTAL, gstAmount: 0, gstRate: 5,
      total: 0, count: 5, reward: undefined,
    }),
  );
  const server = computeOrderTotals({ items: items as never, discount: 50, discountKind: undefined, charge: 0, cfg });
  assert.equal(modal.total, server.total);
  assert.equal(modal.discountKind, undefined);
});

// ── a frozen Pay Now keeps the amount its request carried (review F1) ────────────────────────────────────────

import { NO_POINTS_HOLD, carriedPoints, rowWithHold, stepPointsHold, type PointsHold } from "./settle-points-view";

// Plays the hook's per-render sequence: [frozen, live amount the row would give from the LIVE balance].
function play(steps: [boolean, number][]): { carried: number; hold: PointsHold }[] {
  let hold = NO_POINTS_HOLD;
  return steps.map(([frozen, live]) => {
    hold = stepPointsHold(hold, frozen, live);
    return { carried: carriedPoints(hold, frozen, live), hold };
  });
}

test("F1: the balance dropping to 0 while a send is frozen never re-prices it — 150 stays 150 until it clears", () => {
  const out = play([
    [false, 150], // switch on, 150 carried; Pay Now built from this
    [true, 150], // the send froze (answer timed out)
    [true, 0], // the failed create's refetch reads balance 0
    [true, 0],
  ]);
  assert.deepEqual(out.map((o) => o.carried), [150, 150, 150, 150]);
  assert.equal(rowWithHold(row({ frozen: true, balance: 0 }), true, out[2].carried).amount, 150, "the row still offers the 150 it sent");
  assert.equal(rowWithHold(row({ frozen: true, balance: 0 }), true, out[2].carried).usable, false);
  assert.equal(rowWithHold(row({ frozen: true, balance: 0 }), true, out[2].carried).reason, POINTS_BLOCK_FROZEN);
  // Frozen at once, with the latch not yet stored: still the carried figure (no render where the live one leaks).
  assert.equal(carriedPoints(stepPointsHold({ last: 150, held: null }, false, 150), true, 0), 150);
  assert.equal(carriedPoints({ last: 150, held: null }, true, 0), 150, "even before the step lands");
});

test("F1: once the freeze clears the live balance applies again, and a latch of 0 keeps the live blocked row", () => {
  const out = play([[false, 150], [true, 0], [false, 0], [false, 0]]);
  assert.deepEqual(out.map((o) => o.carried), [150, 150, 0, 0], "after Discard/clear the live amount rules");
  assert.equal(out[2].hold.held, null);
  const none = play([[false, 0], [true, 80], [true, 80]]);
  assert.deepEqual(none.map((o) => o.carried), [0, 0, 0], "switch off at freeze: nothing is carried, a later balance never turns it on");
  const live = row({ frozen: true });
  assert.equal(rowWithHold(live, true, 0), live, "a latch of 0 shows the live row as it is");
  assert.equal(rowWithHold(row({}), false, 0).usable, true, "not frozen: the live row untouched");
});

test("F1: stepPointsHold settles — an unchanged render returns the same object", () => {
  const a = stepPointsHold(NO_POINTS_HOLD, false, 0);
  assert.equal(a, NO_POINTS_HOLD);
  const b = stepPointsHold({ last: 5, held: 5 }, true, 9);
  assert.deepEqual(b, { last: 5, held: 5 });
});
