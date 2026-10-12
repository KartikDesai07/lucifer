/**
 * CB-7 S5 live legs h, i, j, p, r (what a card is WORTH): scope money, the category snapshot, free-item at create vs
 * settle, the strict-schema round trip, the zero-match refusal. Part of verify-reward-card-use-live.ts. (ops CLI
 * support module, not app code.)
 */
import assert from "node:assert/strict";

import { Product } from "@/models/Product";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import { REWARD_SCOPE_PRODUCTS_MAX, CARD_CATEGORY_TOO_BIG, CARD_ITEM_NOT_AT_SETTLE, CARD_NOTHING_TO_DISCOUNT } from "@pos/shared/reward-card-use";
import {
  COFFEE_LARGE, PROMO_CODE, assertCardUntouched, cardOf, coffeeLines, diner, emptyBigCategory, fillBigCategory, line, openTab, ordersOf,
  rawOrder, revealed, seedSettings, settleBody, tabBody, type Ctx, type Line,
} from "./reward-card-use-live-kit";

const PERCENT = 20;
const CAP = 30;
const DEAREST_20 = (COFFEE_LARGE * PERCENT) / 100; // 36: the dearest unit only (owner O1)

export async function runScopeLegs({ api, menu, scenario }: Ctx): Promise<void> {
  const cake = (qty = 1) => line(menu.cake, "Cake", 100, qty);
  const tea = () => line(menu.tea, "Masala Tea", 100);
  const brownie = () => line(menu.brownie, "Brownie", 150);
  // 120 + 180 coffee, one tea, one cake = 500.
  const mixed = (): Line[] => [...coffeeLines(menu), tea(), cake()];
  const coffeeCard = (extra: Partial<RewardCardSnapshot> = {}) => revealed({ kind: "product-percent", value: PERCENT, productId: menu.coffee, productName: "Cold Coffee", ...extra });

  const place = async (card: ReturnType<typeof revealed>, lines: Line[]) => {
    const d = await diner([card]);
    const res = await api.create(tabBody(d, lines, { rewardCardId: card.id }));
    assert.equal(res.status, 201, `create must land - got ${res.status}: ${res.body.error ?? ""}`);
    return { d, data: res.body.data!, doc: await rawOrder(String(res.body.data!._id)) };
  };

  await scenario("h1", "product-percent 20% on a dish billed at Rs 120 and Rs 180 plus other dishes: discount 36 (the dearest unit only), total 464", async () => {
    await seedSettings();
    const { data, doc } = await place(coffeeCard(), mixed());
    assert.equal(data.subtotal, 500);
    assert.equal(data.discount, DEAREST_20, "20% of the Rs 180 unit, not of 120+180 (60) nor of the whole bill (100)");
    assert.equal(data.total, 464);
    assert.deepEqual(doc.rewardScopeProductIds, [menu.coffee], "landmark: the scope is the one product");
    assert.equal(doc.rewardScopeMaxUnits, 1);
  });

  await scenario("h2", "product-percent 20% with capRupees 30: discount 30 (the cap bounds it), the cap is stored", async () => {
    await seedSettings();
    const { data, doc } = await place(coffeeCard({ capRupees: CAP }), mixed());
    assert.equal(data.discount, CAP);
    assert.equal(data.total, 470);
    assert.equal(doc.rewardCapRupees, CAP);
  });

  await scenario("h3", "category-percent 10% on Snacks: only the Snacks lines count (350 of 450 -> 35, never the tea)", async () => {
    await seedSettings();
    const card = revealed({ kind: "category-percent", value: 10, categoryId: menu.snack, categoryName: "Snacks" });
    const { data, doc } = await place(card, [cake(2), brownie(), tea()]);
    assert.equal(data.subtotal, 450);
    assert.equal(data.discount, 35);
    assert.equal(data.total, 415);
    const ids = (doc.rewardScopeProductIds as string[]).slice().sort();
    assert.deepEqual(ids, [menu.cake, menu.brownie, menu.muffin].sort(), "landmark: the category's products were snapshotted at claim");
    assert.equal("rewardScopeMaxUnits" in doc, false, "a category scope has no unit limit");
  });

  await scenario("h4", "category-flat Rs 500 larger than the category's lines: clamped to their sum (250), total 100", async () => {
    await seedSettings();
    const card = revealed({ kind: "category-flat", value: 500, categoryId: menu.snack, categoryName: "Snacks" });
    const { data } = await place(card, [cake(), brownie(), tea()]);
    assert.equal(data.subtotal, 350);
    assert.equal(data.discount, 250, "never more than the Snacks lines (a flat of 500 does not eat the tea)");
    assert.equal(data.total, 100);
  });

  await scenario("h5", "GST exclusive 5%: the card's tax base is subtotal - discount, identical to an equal manual discount (one tax pipeline)", async () => {
    await seedSettings({ gst: true });
    const { data, doc } = await place(coffeeCard(), mixed());
    assert.equal(doc.gstMode, "exclusive", "landmark: GST is on for this order");
    assert.equal(data.discount, DEAREST_20);
    const base = 500 - DEAREST_20;
    assert.equal(data.gstAmount, Math.round((base * 5) / 100), "GST is 5% of 464, hand-computed");
    assert.equal(data.total, base + (data.gstAmount as number));
    const manual = await api.create(tabBody(null, mixed(), { discount: DEAREST_20 }));
    assert.equal(manual.status, 201);
    for (const key of ["subtotal", "discount", "gstAmount", "total"]) assert.equal(manual.body.data![key], data[key], `an equal manual discount prices ${key} identically`);
  });

  await scenario("i1", "category snapshot: after the claim a product moves to another category; the add-round still re-prices with the STORED ids (25, not 10)", async () => {
    await seedSettings();
    const card = revealed({ kind: "category-percent", value: 10, categoryId: menu.snack, categoryName: "Snacks" });
    const { data, doc } = await place(card, [cake(), tea()]);
    assert.equal(data.discount, 10, "landmark: 10% of the cake alone");
    const id = String(data._id);
    await Product.updateOne({ _id: menu.brownie }, { categoryId: menu.bev });
    try {
      const round = await api.addRound(id, { items: [brownie()], discount: 10, discountKind: null });
      assert.equal(round.status, 200, `the round must land - got ${round.status}: ${round.body.error ?? ""}`);
      assert.equal(round.body.data!.discount, 25, "10% of cake + brownie: the brownie is still in the stored scope");
      assert.deepEqual((await rawOrder(id)).rewardScopeProductIds, doc.rewardScopeProductIds, "the stored ids did not change");
    } finally {
      await Product.updateOne({ _id: menu.brownie }, { categoryId: menu.snack });
    }
  });

  await scenario("i2", `a category with more than ${REWARD_SCOPE_PRODUCTS_MAX} dishes is refused (CARD_CATEGORY_TOO_BIG), nothing claimed`, async () => {
    await seedSettings();
    await fillBigCategory(menu);
    try {
      const card = revealed({ kind: "category-flat", value: 50, categoryId: menu.big, categoryName: "Bulk" });
      const d = await diner([card]);
      const res = await api.create(tabBody(d, [cake(2)], { rewardCardId: card.id }));
      assert.equal(res.status, 400);
      assert.equal(res.body.error, CARD_CATEGORY_TOO_BIG);
      assert.equal(await ordersOf(d.id), 0);
      await assertCardUntouched(d, card, "the too-big category");
    } finally {
      await emptyBigCategory(menu);
    }
  });

  await scenario("j", "free-item card: allowed at create (reward line worth Rs 0, kind reward stored at Rs 0), refused at settle (CARD_ITEM_NOT_AT_SETTLE); a money card at settle lands", async () => {
    await seedSettings();
    const free = () => revealed({ kind: "free-item", value: 0, productId: menu.muffin, productName: "Muffin", qty: 1 });
    const { d, data, doc } = await place(free(), [cake(2)]);
    assert.equal(data.discount, 0, "the free dish is a line, not rupees off");
    assert.equal(data.total, 200, "the free line adds Rs 0 to the total");
    assert.equal(data.discountKind, "reward", "kind reward is stored even at Rs 0");
    const lines = doc.items as Array<Record<string, unknown>>;
    assert.ok(lines.some((l) => l.reward === true && String(l.productId) === menu.muffin), "landmark: the reward line for the Muffin is on the bill");
    assert.equal(doc.rewardKind, "item");
    assert.equal(doc.rewardItemProductId, menu.muffin);
    assert.equal(doc.rewardQty, 1);
    assert.equal((await cardOf(d, (doc.rewardCardId as string))).status, "used");

    const card = free();
    const e = await diner([card]);
    const tab = await openTab(api, e, [cake(2)]);
    const refused = await api.settle(tab, { ...settleBody(await rawOrder(tab)), rewardCardId: card.id });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, CARD_ITEM_NOT_AT_SETTLE);
    assert.equal((await rawOrder(tab)).status, "Pending", "the tab stays open");
    await assertCardUntouched(e, card, "the free-dish settle");

    const money = revealed({ kind: "bill-flat", value: 50 });
    const f = await diner([money]);
    const tab2 = await openTab(api, f, [cake(2)]);
    const settled = await api.settle(tab2, { ...settleBody(await rawOrder(tab2)), rewardCardId: money.id });
    assert.equal(settled.status, 200, `a money card claimed at settle must land - got ${settled.status}: ${settled.body.error ?? ""}`);
    assert.equal(settled.body.data!.status, "Completed");
    assert.equal(settled.body.data!.discount, 50);
    assert.equal(settled.body.data!.total, 150);
    const done = await rawOrder(tab2);
    assert.equal(done.rewardCardId, money.id);
    assert.equal("rewardAt" in done, false);
    assert.equal((await cardOf(f, money.id)).orderId, done.orderId, "the settle claim is keyed on the order");
  });

  await scenario("p", "strict-schema round trip: every card field (and the promo marker) persists on the Order doc, as strings, and survives a re-pricing round", async () => {
    await seedSettings();
    const { data, doc } = await place(coffeeCard({ capRupees: CAP }), mixed());
    const fields = ["rewardCardId", "rewardKind", "rewardValue", "rewardItem", "rewardScopeProductIds", "rewardScopeMaxUnits", "rewardScopeLabel", "rewardCapRupees"] as const;
    assert.equal(doc.rewardKind, "percent");
    assert.equal(doc.rewardValue, PERCENT);
    assert.equal(doc.rewardScopeLabel, "Cold Coffee");
    assert.equal(doc.rewardCapRupees, CAP);
    assert.equal(doc.rewardScopeMaxUnits, 1);
    assert.equal(typeof doc.rewardCardId, "string");
    assert.ok((doc.rewardScopeProductIds as unknown[]).every((v) => typeof v === "string"), "the scope ids are plain strings");
    assert.equal("promoCode" in doc, false, "a card bill carries no promo marker");
    const round = await api.addRound(String(data._id), { items: [tea()], discount: 0, discountKind: null });
    assert.equal(round.status, 200);
    const after = await rawOrder(String(data._id));
    for (const f of fields) assert.deepEqual(after[f], doc[f], `${f} survives the re-pricing round`);
    assert.equal(after.discount, CAP, "and the round re-priced from the snapshot");
    const promo = await rawOrder(await openTab(api, null, [cake(2)], { promoCode: PROMO_CODE }));
    assert.equal(promo.promoCode, PROMO_CODE, "the promo marker persists too");
  });

  await scenario("r", "a product card whose dish is not on the bill: CARD_NOTHING_TO_DISCOUNT, no order, the card is not burned", async () => {
    await seedSettings();
    const card = coffeeCard();
    const d = await diner([card]);
    const res = await api.create(tabBody(d, [cake(2)], { rewardCardId: card.id }));
    assert.equal(res.status, 400);
    assert.equal(res.body.error, CARD_NOTHING_TO_DISCOUNT);
    assert.equal(await ordersOf(d.id), 0);
    await assertCardUntouched(d, card, "the zero-match bill");
  });
}
