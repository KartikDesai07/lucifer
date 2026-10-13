import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PROMO_BLOCKS_REWARD } from "@pos/shared/public-promo";
import { ONE_REWARD_PER_BILL, REWARD_NEEDS_NEW_ITEMS } from "@pos/shared/reward-card-use";
import { stripComments } from "@/lib/source-pin-utils";
import { canCarryClaim, hasOrderReward, promoMarkerFields, rewardClaimOrderFence, rewardClaimRefusal } from "./order-reward-fence";

// CB-7 S5 (P2) — the one-reward-per-bill fence. Pure builders, so every refusal string and the exact CAS filter shape
// are pinned with plain deep-equals (the claim writers wire it in later slices).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = "SAVE50";
const CARD_ID = "a1b2c3d4e5f6";

test("hasOrderReward: true for each of the three markers alone, false for a clean bill", () => {
  assert.equal(hasOrderReward({}), false);
  assert.equal(hasOrderReward({ discountKind: undefined }), false);
  assert.equal(hasOrderReward({ discountKind: "gst" }), false, "a GST preset is not a reward");
  assert.equal(hasOrderReward({ discountKind: "reward" }), true);
  assert.equal(hasOrderReward({ rewardAt: 8 }), true, "an anomaly row: a stamp rung with the kind swapped away");
  assert.equal(hasOrderReward({ rewardCardId: CARD_ID }), true, "an anomaly row: a card id with the kind swapped away");
  assert.equal(hasOrderReward({ rewardPoints: 40 }), true, "an anomaly row: spent points with the kind swapped away");
  assert.equal(hasOrderReward({ discountKind: "gst", rewardAt: 8, rewardCardId: CARD_ID }), true);
});

test("hasOrderReward: a stored rewardAt of 0 still counts (presence, never truthiness)", () => {
  assert.equal(hasOrderReward({ rewardAt: 0 }), true);
});

test("rewardClaimRefusal: promo first, then an existing reward, else null", () => {
  assert.equal(rewardClaimRefusal({}), null);
  assert.equal(rewardClaimRefusal({ discountKind: "gst" }), null);
  assert.equal(rewardClaimRefusal({ promoCode: CODE }), PROMO_BLOCKS_REWARD);
  assert.equal(rewardClaimRefusal({ discountKind: "reward" }), ONE_REWARD_PER_BILL);
  assert.equal(rewardClaimRefusal({ rewardAt: 4 }), ONE_REWARD_PER_BILL);
  assert.equal(rewardClaimRefusal({ rewardCardId: CARD_ID }), ONE_REWARD_PER_BILL);
  assert.equal(rewardClaimRefusal({ rewardPoints: 40 }), ONE_REWARD_PER_BILL);
  assert.equal(
    rewardClaimRefusal({ promoCode: CODE, discountKind: "reward", rewardAt: 4, rewardCardId: CARD_ID }),
    PROMO_BLOCKS_REWARD,
    "when both are present the promo answer wins (the promo's discount is the bill's money)",
  );
});

test("rewardClaimOrderFence: the exact CAS terms, customerId carried through by identity", () => {
  const customerId = { toString: () => "60a1b2c3d4e5f60718293a4b" };
  const fence = rewardClaimOrderFence({ customerId });
  assert.deepEqual(fence, {
    discountKind: { $ne: "reward" },
    rewardAt: { $exists: false },
    rewardCardId: { $exists: false },
    rewardPoints: { $exists: false },
    promoCode: { $exists: false },
    customerId,
  });
  assert.equal(fence.customerId, customerId, "the same value, not a copy or a string");
});

test("rewardClaimOrderFence: an anonymous bill keeps the customerId term (it must still miss if one is attached)", () => {
  const fence = rewardClaimOrderFence({});
  assert.ok("customerId" in fence, "the term is always present");
  assert.equal(fence.customerId, undefined);
});

test("rewardClaimOrderFence: every refusal marker has a matching CAS term (read and write guards cannot drift)", () => {
  const fence = rewardClaimOrderFence({ customerId: "x" });
  for (const key of ["discountKind", "rewardAt", "rewardCardId", "rewardPoints", "promoCode"]) {
    assert.ok(key in fence, `the fence must guard ${key}`);
  }
});

test("promoMarkerFields: omit-empty — no applied code writes no key at all", () => {
  const none = promoMarkerFields(undefined);
  assert.deepEqual(none, {});
  assert.ok(!("promoCode" in none), "absence stays absence, never promoCode: undefined");
  assert.deepEqual(promoMarkerFields(CODE), { promoCode: CODE });
});

test("promoMarkerFields: keyed on APPLIED, not the amount — a zero-rupee promo is still marked", () => {
  // A free-dish promo is worth Rs 0 in rupees; the caller passes its code because promoIsClaimable(0, code, "item") is
  // true. The marker must carry the code regardless of any amount (the helper never sees one).
  assert.deepEqual(promoMarkerFields(CODE), { promoCode: CODE });
  assert.equal(promoMarkerFields.length, 1, "the signature takes the applied code only — no amount to gate on");
});

test("source pin: order-reward-fence.ts is pure — it imports no model, no Mongoose, no DB", () => {
  const code = stripComments(readFileSync(path.join(HERE, "order-reward-fence.ts"), "utf8"));
  assert.ok(code.includes("rewardClaimOrderFence"), "landmark: this is the fence module");
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imports.length >= 2, "landmark: the module imports the shared copy");
  for (const spec of imports) {
    assert.ok(spec.startsWith("@pos/shared/"), `only shared copy may be imported, found ${spec}`);
  }
  assert.ok(!/mongoose|@\/models|\.\.\/models|connectDB/.test(code), "no Mongoose, model or connection reference");
});

// ── G1 (s91 arbiter round 2): a NEW reward needs a round to carry its claim (D9: claimed at order-taking, never at
// settle). A resumed tab with only SENT lines settled with an armed rung / card was billed as a plain manual discount
// and nothing was spent. The pins below run on the real source AND on mutated copies they must reject.

const SENT = { kotRound: 1 };
const UNSENT = { kotRound: 0 };
const RESUMED = { _id: "tab-1" };
const CAFE = path.join(HERE, "..");
const readCafe = (rel: string): string => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));
function pinned(label: string, src: string, pin: (s: string) => boolean, ...mutations: Array<(s: string) => string>): void {
  assert.ok(pin(src), `${label}: holds on the real source`);
  mutations.forEach((mutate, i) => {
    const mutated = mutate(src);
    assert.notEqual(mutated, src, `${label}: mutation ${i} changes the text`);
    assert.ok(!pin(mutated), `${label}: mutation ${i} is caught`);
  });
}
const swap = (from: string, to: string) => (s: string) => s.replace(from, to);
const between = (s: string, start: string, end: string): string => {
  const a = s.indexOf(start);
  const b = s.indexOf(end, a + 1);
  return a >= 0 && b > a ? s.slice(a, b) : "";
};

test("G1 canCarryClaim: a fresh cart always can; a resumed tab only while it has an unsent line", () => {
  assert.equal(canCarryClaim(null, []), true, "a fresh cart: the create carries the claim");
  assert.equal(canCarryClaim(null, [UNSENT]), true);
  assert.equal(canCarryClaim(RESUMED, []), false, "a resumed tab with nothing new");
  assert.equal(canCarryClaim(RESUMED, [SENT, { kotRound: 2 }]), false, "only SENT lines: the settle would carry no claim (D9)");
  assert.equal(canCarryClaim(RESUMED, [SENT, UNSENT]), true, "one unsent line: the add-round carries the claim");
});

test("G1 copy: the reason is one plain-English line that says what to do", () => {
  assert.equal(typeof REWARD_NEEDS_NEW_ITEMS, "string");
  assert.ok(REWARD_NEEDS_NEW_ITEMS.length > 0 && !REWARD_NEEDS_NEW_ITEMS.includes("\n"), "one non-empty line");
  assert.match(REWARD_NEEDS_NEW_ITEMS, /add an item/i, "says what the cashier can do");
  assert.match(REWARD_NEEDS_NEW_ITEMS, /not at payment/i, "says why the settle cannot take it");
});

test("PIN (G1): use-customer-rewards gates every NEW pick on canCarryClaim — readers, preview, both payload fields, the card pick and the auto-default", () => {
  const src = readCafe("hooks/use-customer-rewards.ts");
  const pin = (s: string): boolean => {
    const effect = between(s, "useEffect(", "}, [rewardOffers");
    const deps = between(s, "}, [rewardOffers", ");");
    const disarm = effect.indexOf("if (noRound && rewardAt !== null) {");
    const standDown = effect.indexOf("if (blocked) return;");
    return (
      /import \{[^}]*\bcanCarryClaim\b[^}]*\} from "@\/lib\/order-reward-fence"/.test(s) &&
      /import \{[^}]*\bREWARD_NEEDS_NEW_ITEMS\b[^}]*\} from "@pos\/shared\/reward-card-use"/.test(s) &&
      s.includes("const noRound = !canCarryClaim(resumedOrder, lines);") &&
      s.includes("const blocked = locked || promoLocked || noRound;") &&
      // The one gate reaches the reader of each pick, the preview and both wire fields.
      s.includes("pendingRewardAt: blocked ||") && s.includes("selectedReward: blocked ||") && s.includes("pendingCardId: blocked ||") &&
      /const onSelectReward = \(at: number \| null\) => \{\s*if \(blocked\) return;/.test(s) &&
      /const onSelectCard = \(id: string \| null\) => \{\s*if \(blocked\) return;/.test(s) &&
      // The auto-default DISARMS a rung it already armed (as for a manual discount), before its blocked stand-down.
      /if \(noRound && rewardAt !== null\) \{\s*setRewardAt\(null\);\s*autoPickedRef\.current = false;\s*\}/.test(effect) &&
      disarm >= 0 && standDown > disarm && /\bnoRound\b/.test(deps) &&
      // A card pick stands down too (the clean-up effect then clears it), and the reason reaches CartReward.
      s.includes("cardPick.tabKey === tabKey && !manualDiscountActive && !noRound") &&
      s.includes("rewardBlockedReason: promoLocked ? PROMO_BLOCKS_REWARD : noRound ? REWARD_NEEDS_NEW_ITEMS : null,")
    );
  };
  pinned(
    "use-customer-rewards.ts", src, pin,
    swap("const noRound = !canCarryClaim(resumedOrder, lines);", "const noRound = false;"),
    swap("const blocked = locked || promoLocked || noRound;", "const blocked = locked || promoLocked;"),
    swap("if (noRound && rewardAt !== null) {", "if (false) {"),
    swap("blocked, manualDiscountActive, noRound]", "blocked, manualDiscountActive]"),
    swap(" && !noRound", ""),
    swap("noRound ? REWARD_NEEDS_NEW_ITEMS : null", "null"),
    swap("pendingCardId: blocked ||", "pendingCardId:"),
  );
});

test("PIN (G1): CartReward shows the hook's reason INSTEAD of both pickers, and a locked tab still shows its own reward first", () => {
  const reward = readCafe("components/pos/CartReward.tsx");
  const locked = reward.indexOf("{locked ? (");
  const reason = reward.indexOf("blockedReason !== null ? (");
  const rungs = reward.indexOf("<RungButton");
  const cards = reward.indexOf("<CartRewardCards");
  assert.ok(locked >= 0 && reason >= 0 && rungs >= 0 && cards >= 0, "landmarks: the locked branch, the reason, both pickers");
  assert.ok(locked < reason, "a tab that already carries a reward keeps showing it (the reason never hides a stored reward)");
  assert.ok(reason < rungs && reason < cards, "the reason renders in place of the rung chips and the card list");
  assert.match(reward, /<p className="text-xs text-muted-foreground">\{blockedReason\}<\/p>/, "the reason is the one plain line");
  assert.match(readCafe("lib/pos-cart-props.ts"), /rewardBlockedReason: pos\.rewardBlockedReason,/, "hook -> cart props");
  assert.match(readCafe("components/pos/Cart.tsx"), /blockedReason=\{rewardBlockedReason\}/, "cart props -> CartReward");
});

test("PIN (G1): use-pos-tab hands the cart itself (kotRound per line) to the selection, and settle stays claim-free", () => {
  const tab = readCafe("hooks/use-pos-tab.ts");
  assert.match(tab, /customer, plain\.total, resumedOrder, rewardAt, setRewardAt,\s*discountRaw, discountUnit, setDiscountRaw, setDiscountUnit, cart, promoCode,/, "resumedOrder and cart reach the predicate");
  const settle = between(tab, "const settlePayload = (", "\n  });");
  assert.ok(settle.includes("discount,"), "landmark: the settle sends the shown discount");
  // CB-7 S6 (§2.7, plan FLAG 4) — re-specced, not weakened: points are the ONE reward that rides the settle (A4). The
  // payload may carry `rewardPoints` and nothing else reward-shaped: never a stamp rung or a card id.
  assert.ok(!/rewardAt|rewardCardId/.test(settle), "the settle payload never names a stamp rung or a card — those only travel with a round");
  const withoutPoints = settle.replace(/\brewardPoints\b/g, "");
  assert.ok(!/reward/i.test(withoutPoints), "apart from rewardPoints the settle payload names no reward");
  for (const m of settle.matchAll(/\brewardPoints\b(?!:|,)/g)) {
    assert.fail(`rewardPoints must be a plain property of the payload (found "${settle.slice(m.index, m.index + 20)}")`);
  }
  // Tightened now the hook exists (hooks/use-settle-points.ts): the ONLY source is the points hook's own amount, sent as
  // a whole number or omitted — never a number computed here, never `reward.*`.
  assert.equal(settle.split("rewardPoints").length - 1, 1, "the settle payload names rewardPoints exactly once");
  assert.ok(settle.includes("rewardPoints: points.amount || undefined,"), "rewardPoints comes from the points hook alone, omitted when 0");
  assert.match(tab, /const points = useSettlePoints\(\{/, "landmark: the hook is called in use-pos-tab");
});

test("PIN (S6 slice C): Pay Now's create carries the points; Send to Kitchen, the add-round and the plain create payload never do", () => {
  const tab = readCafe("hooks/use-pos-tab.ts");
  const build = between(tab, "const buildCreatePayload = (", "...overrides,");
  const round = between(tab, "const round = resumedOrder", "const create = buildCreatePayload");
  const sale = between(tab, "const sale = buildCreatePayload({", "});");
  assert.ok(build.includes("rewardAt: reward.pendingRewardAt") && round.includes("rewardAt: reward.pendingRewardAt"), "landmarks: both order-taking payloads");
  assert.ok(!/rewardPoints/.test(build), "the create payload sent by Send to Kitchen (status Pending) carries no points: they are spent at payment only");
  assert.ok(!/rewardPoints/.test(round), "the add-round payload carries no points");
  assert.ok(sale.includes('status: "Completed"') && sale.includes("rewardPoints: points.amount || undefined,"), "Pay Now's create (Completed) carries the points");
});
