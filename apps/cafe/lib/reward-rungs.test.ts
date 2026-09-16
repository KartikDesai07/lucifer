import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "./source-pin-utils";
import { rungOffers, pickDefaultRung, rungWorthLabel, type RewardRung } from "./reward-rungs";
import { rewardClaimMessage } from "./reward-claim";
import { inr } from "./utils";

// CB-5B S9 — pins for the STAFF POS reward-picker surface: lib/reward-rungs.ts
// (the pure preview library) plus the shipped wiring across the route, the two
// hooks, CartReward, Cart.tsx, pos-cart-props.ts and use-pos-tab.ts. Same
// discipline as gst-discount.test.ts / reward-wiring.test.ts: behavioural unit
// tests directly against the pure module, source pins (readSrc + stripComments)
// for the wiring, every negative pin vision-guarded by a positive landmark.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(path.join(HERE, "..", rel), "utf8");

function rung(over: Partial<RewardRung> = {}): RewardRung {
  return { at: 10, kind: "flat", value: 50, item: "", minBill: null, affordable: true, ...over };
}

// ══════════════════════════════════════════════════════════════════════════
// PART 1 — behavioural unit tests over lib/reward-rungs.ts
// ══════════════════════════════════════════════════════════════════════════

// ── (a) rungOffers mirrors decideRedemption's CHECK ORDER ───────────────────

test("rungOffers: a rung that is BOTH unaffordable AND below minBill reports insufficient-stamps, never below-min-bill — mirrors decideRedemption checking stamps before minBill", () => {
  const r = rung({ at: 500, minBill: 1000, affordable: false });
  const [offer] = rungOffers([r], 0); // billTotal 0 is also below minBill 1000
  assert.equal(offer!.usable, false);
  assert.equal(
    offer!.reason,
    rewardClaimMessage("insufficient-stamps"),
    "the reason must be the exact insufficient-stamps message imported from lib/reward-claim.ts, never a hand-typed copy",
  );
  assert.notEqual(offer!.reason, rewardClaimMessage("below-min-bill"), "must not report below-min-bill when stamps are also short");
});

test("rungOffers: an affordable rung below minBill reports below-min-bill, via rewardClaimMessage — not a hand-typed string", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  const [offer] = rungOffers([r], 100);
  assert.equal(offer!.usable, false);
  assert.equal(offer!.reason, rewardClaimMessage("below-min-bill"));
});

test("rungOffers: affordable + bill at/above minBill is usable, with no reason", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  const [offer] = rungOffers([r], 500);
  assert.equal(offer!.usable, true);
  assert.equal(offer!.reason, undefined, "a usable offer must carry no reason");
});

// ── (b) minBill: null is usable at ANY bill total, including 0 ──────────────

test("rungOffers: minBill:null is usable at bill totals 0, 1, and a huge number — the gate never applies", () => {
  const r = rung({ at: 10, minBill: null, affordable: true });
  for (const billTotal of [0, 1, 999999]) {
    const [offer] = rungOffers([r], billTotal);
    assert.equal(offer!.usable, true, `minBill:null must be usable at billTotal=${billTotal}`);
  }
});

// ── (c) boundary EXACTness, both directions ──────────────────────────────────

test("rungOffers: billTotal === minBill is USABLE (server uses billTotal < minBill to refuse, so equality passes)", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  const [offer] = rungOffers([r], 500);
  assert.equal(offer!.usable, true, "billTotal exactly equal to minBill must pass — the server's own check is strictly-less-than");
});

test("rungOffers: billTotal one rupee under minBill is NOT usable", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  const [offer] = rungOffers([r], 499);
  assert.equal(offer!.usable, false);
  assert.equal(offer!.reason, rewardClaimMessage("below-min-bill"));
});

test("rungOffers: affordability boundary — affordable:true at the rung's own `at` is usable (affordable is decided upstream, this just reads the flag)", () => {
  // affordable is computed by the CALLER (route) as stamps >= at; rungOffers
  // itself only reads the boolean, so the boundary lives at the caller. This
  // pins that reading true through unchanged, at any minBill.
  const atBoundary = rung({ at: 10, affordable: true, minBill: null });
  assert.equal(rungOffers([atBoundary], 0)[0]!.usable, true);
  const oneUnder = rung({ at: 10, affordable: false, minBill: null });
  assert.equal(rungOffers([oneUnder], 0)[0]!.usable, false, "affordable:false must never be usable regardless of minBill");
});

// ── (d) TOTALITY: non-finite billTotal treated as 0 ──────────────────────────

test("rungOffers: a non-finite billTotal (NaN) is treated as 0 and must NOT mark a gated rung usable — NaN < 500 is false, which would silently make every gated rung look available", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  const [offer] = rungOffers([r], NaN);
  assert.equal(
    offer!.usable,
    false,
    "NaN billTotal must be treated as 0 (0 < 500 is true, so this must be refused) — not propagate NaN, which would make `NaN < 500` false and wrongly mark this usable",
  );
  assert.equal(offer!.reason, rewardClaimMessage("below-min-bill"));
});

test("rungOffers: a non-finite billTotal (Infinity, -Infinity) is also treated as 0, not left to propagate", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  for (const bad of [Infinity, -Infinity]) {
    const [offer] = rungOffers([r], bad);
    assert.equal(offer!.usable, false, `billTotal=${bad} must be treated as 0 (below minBill 500)`);
  }
});

test("rungOffers: a FINITE billTotal is used verbatim, not accidentally clamped to 0 too", () => {
  const r = rung({ at: 10, minBill: 500, affordable: true });
  assert.equal(rungOffers([r], 500)[0]!.usable, true, "a real, finite 500 must pass — the non-finite guard must not swallow valid numbers");
  assert.equal(rungOffers([r], 0)[0]!.usable, false, "a real, finite 0 must still be refused against minBill 500");
});

// ── (e) pickDefaultRung: highest `at` among USABLE offers ────────────────────

test("pickDefaultRung: returns the highest `at` among usable offers", () => {
  const offers = rungOffers(
    [rung({ at: 5, affordable: true }), rung({ at: 20, affordable: true }), rung({ at: 10, affordable: true })],
    0,
  );
  const best = pickDefaultRung(offers);
  assert.equal(best?.rung.at, 20);
});

test("pickDefaultRung: the highest-`at` rung overall is NOT usable — it must be SKIPPED, not returned", () => {
  const offers = rungOffers(
    [
      rung({ at: 5, affordable: true }),
      rung({ at: 20, affordable: false }), // highest `at`, but unaffordable
      rung({ at: 10, affordable: true }),
    ],
    0,
  );
  const best = pickDefaultRung(offers);
  assert.equal(best?.rung.at, 10, "the unaffordable at=20 rung must be skipped in favour of the highest USABLE one (at=10)");
});

test("pickDefaultRung: undefined when none is usable", () => {
  const offers = rungOffers([rung({ at: 5, affordable: false }), rung({ at: 20, affordable: false })], 0);
  assert.equal(pickDefaultRung(offers), undefined);
});

test("pickDefaultRung: undefined for an empty offers array", () => {
  assert.equal(pickDefaultRung([]), undefined);
});

// ── (f) rungWorthLabel per kind ───────────────────────────────────────────────

test("rungWorthLabel: kind 'flat' renders '<inr(value)> off your bill'", () => {
  const label = rungWorthLabel(rung({ kind: "flat", value: 100 }));
  assert.equal(label, `${inr(100)} off your bill`);
});

test("rungWorthLabel: kind 'percent' renders '<value>% off your bill'", () => {
  const label = rungWorthLabel(rung({ kind: "percent", value: 10 }));
  assert.equal(label, "10% off your bill");
});

test("rungWorthLabel: kind 'item' with a name renders the dish name verbatim", () => {
  const label = rungWorthLabel(rung({ kind: "item", value: 0, item: "Masala Chai" }));
  assert.equal(label, "Masala Chai");
});

test("rungWorthLabel: kind 'item' with an EMPTY name falls back to 'a free item' — never an empty string on a chip", () => {
  const label = rungWorthLabel(rung({ kind: "item", value: 0, item: "" }));
  assert.equal(label, "a free item");
});

test("rungWorthLabel: a non-finite value never produces the literal 'NaN' — flat and percent both clamp to 0", () => {
  for (const bad of [NaN, Infinity, -Infinity]) {
    const flatLabel = rungWorthLabel(rung({ kind: "flat", value: bad }));
    const pctLabel = rungWorthLabel(rung({ kind: "percent", value: bad }));
    assert.ok(!flatLabel.includes("NaN"), `flat label for value=${bad} must not contain "NaN", got "${flatLabel}"`);
    assert.ok(!pctLabel.includes("NaN"), `percent label for value=${bad} must not contain "NaN", got "${pctLabel}"`);
    assert.equal(flatLabel, `${inr(0)} off your bill`);
    assert.equal(pctLabel, "0% off your bill");
  }
});

// ── (g) an empty rung list produces an empty offer list and no default ──────

test("rungOffers([], billTotal) is an empty array, and pickDefaultRung of it is undefined", () => {
  const offers = rungOffers([], 500);
  assert.deepEqual(offers, []);
  assert.equal(pickDefaultRung(offers), undefined);
});

// ══════════════════════════════════════════════════════════════════════════
// PART 2 — source pins (the shipped-wiring half)
// ══════════════════════════════════════════════════════════════════════════

// ── 1: RAW STAMPS, never cyclePosition/ladderProgress ────────────────────────
// THE SLICE'S CENTRAL TRAP: the diner ladder renders against `stamps %
// cycleLength` (cyclePosition/ladderProgress), a DIFFERENT number once a diner
// has looped the ladder. A staff picker built on that number would pre-select
// (or allow) a rung the server then refuses with a 400, because the server's
// own claim gate (decideRedemption) reads the customer's RAW `stamps` field
// with no modulo. This route must compute `affordable` from raw stamps only.

test("PIN (CENTRAL TRAP): app/api/customers/[id]/rewards/route.ts computes affordable from RAW stamps (stamps >= m.at) and never references cyclePosition/ladderProgress", () => {
  const src = stripComments(readSrc("app/api/customers/[id]/rewards/route.ts"));
  // Positive landmark: the route really does resolve the ladder via
  // resolveLoyaltyConfig and returns success(...) — so the negative pin below
  // is scoped to a file that genuinely does the real work, not an empty stub.
  assert.match(src, /resolveLoyaltyConfig\(settings\)/, "landmark: route.ts must call resolveLoyaltyConfig(settings)");
  assert.match(src, /return success\(response\)/, "landmark: route.ts must return success(response)");
  // WIDENED (same session, never loosened): the original needle required a
  // COMMA immediately after `m.at`, i.e. that the stamp test was the WHOLE
  // expression. An adversarial-review HIGH then required a second conjunct —
  // a duplicated `at` is refused by the claim gate as ambiguous, and a rung
  // that auto-selects into a guaranteed 400 blocks the counter entirely. That
  // trailing comma was incidental to what this pin protects: that the stamp
  // term is RAW `stamps >= m.at` and never a cyclePosition derivative. The
  // term itself is still pinned exactly; only what may FOLLOW it widened, and
  // the negative cyclePosition/ladderProgress assertions below are untouched.
  assert.match(
    src,
    /affordable:\s*stamps\s*>=\s*m\.at\b/,
    "affordable must be computed from stamps >= m.at — the RAW stamp balance against the milestone's own `at`, mirroring decideRedemption's `stamps < milestone.at` check",
  );
  // Negative pin, vision-guarded above: a picker built on cyclePosition/
  // ladderProgress would pre-select a rung the server's real claim gate then
  // refuses with a 400 the moment a diner has looped the ladder once.
  assert.ok(
    !/cyclePosition/.test(src),
    "route.ts must NEVER reference cyclePosition — that is the diner ladder's stamps % cycleLength view, a DIFFERENT number from the raw stamps decideRedemption actually gates on",
  );
  assert.ok(
    !/ladderProgress/.test(src),
    "route.ts must NEVER reference ladderProgress — same trap as cyclePosition, just the other name for the modulo'd view",
  );
});

// ── 2: minBill is passed through, never evaluated (no bill in hand) ─────────

test("PIN: the rewards route passes minBill THROUGH unevaluated — no comparison of a bill against it (the route has no live cart total)", () => {
  const src = stripComments(readSrc("app/api/customers/[id]/rewards/route.ts"));
  assert.match(src, /minBill:\s*m\.minBill,/, "landmark: the route must pass minBill: m.minBill through into StaffRewardRung");
  // Negative pin: no comparison of any bill-like value against minBill in this
  // file — that gate belongs entirely to the client (lib/reward-rungs.ts),
  // which has the live cart total this route never sees.
  assert.ok(
    !/minBill\s*[<>]=?/.test(src) && !/[<>]=?\s*.*minBill/.test(src),
    "route.ts must not compare anything against minBill — it has no bill total to gate with; that gate belongs to the client (lib/reward-rungs.ts)",
  );
});

// ── 3: MONEY FENCE — client never sends an amount/kind/value/dish, only `at` ─

test("PIN (MONEY FENCE): hooks/use-pos-tab.ts sends rewardAt, and NEVER a reward value/kind/amount/dish, to the server", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  // Positive landmark: rewardAt really is threaded into a payload here.
  assert.match(src, /rewardAt:\s*reward\.pendingRewardAt,/, "landmark: use-pos-tab.ts must send rewardAt: reward.pendingRewardAt in a payload");
  // Negative pin: bar the SHAPE of sending a reward money/kind/dish field, not
  // just a specific name — a payload key like rewardValue/rewardKind/
  // rewardAmount/rewardItem would let a client mint its own discount.
  assert.ok(!/rewardValue\s*:/.test(src), "use-pos-tab.ts must never send a rewardValue key");
  assert.ok(!/rewardKind\s*:/.test(src), "use-pos-tab.ts must never send a rewardKind key");
  assert.ok(!/rewardAmount\s*:/.test(src), "use-pos-tab.ts must never send a rewardAmount key");
  assert.ok(!/rewardItem\s*:/.test(src), "use-pos-tab.ts must never send a rewardItem key");
  assert.ok(!/rewardQty\s*:/.test(src), "use-pos-tab.ts must never send a rewardQty key");
});

test("PIN (MONEY FENCE): hooks/use-customer-rewards.ts never builds or sends a payload carrying a reward value/kind/amount/dish key", () => {
  const src = stripComments(readSrc("hooks/use-customer-rewards.ts"));
  // Positive landmark: this file DOES deal with rewardAt (the identifier),
  // so the absence pin below is scoped against a file that is genuinely part
  // of the reward-selection flow, not an unrelated/empty file.
  assert.match(src, /rewardAt/, "landmark: use-customer-rewards.ts must reference rewardAt somewhere (it owns onSelectReward(at))");
  assert.ok(!/rewardValue\s*:/.test(src), "use-customer-rewards.ts must never send a rewardValue key");
  assert.ok(!/rewardKind\s*:/.test(src), "use-customer-rewards.ts must never send a rewardKind key");
  assert.ok(!/rewardAmount\s*:/.test(src), "use-customer-rewards.ts must never send a rewardAmount key");
  assert.ok(!/rewardItem\s*:/.test(src), "use-customer-rewards.ts must never send a rewardItem key");
});

test("PIN (MONEY FENCE): components/pos/CartReward.tsx never sends a reward value/kind/amount/dish — onSelect is only ever called with `at` (a number) or null", () => {
  const src = stripComments(readSrc("components/pos/CartReward.tsx"));
  // Positive landmark: onSelect really is wired to rung.at, so this file is
  // genuinely part of the selection surface.
  assert.match(src, /onSelect\(selected\s*\?\s*null\s*:\s*rung\.at\)/, "landmark: CartReward.tsx's onClick must call onSelect with rung.at (or null)");
  assert.ok(!/rewardValue\s*:/.test(src), "CartReward.tsx must never send a rewardValue key");
  assert.ok(!/rewardKind\s*:/.test(src), "CartReward.tsx must never send a rewardKind key");
  assert.ok(!/rewardAmount\s*:/.test(src), "CartReward.tsx must never send a rewardAmount key");
  assert.ok(!/rewardItem\s*:/.test(src), "CartReward.tsx must never send a rewardItem key");
  // Onwards: onSelect's only two call sites in this file must pass either
  // rung.at or a bare null — never any other shape.
  const onSelectCalls = src.match(/onSelect\([^)]*\)/g) ?? [];
  assert.ok(onSelectCalls.length > 0, "landmark: CartReward.tsx must call onSelect at least once");
  for (const call of onSelectCalls) {
    assert.ok(
      /rung\.at/.test(call) || /\bnull\b/.test(call),
      `every onSelect(...) call site must pass rung.at or null, got: ${call}`,
    );
  }
});

// ── 4: order-taking payloads carry the intent; SETTLE DOES NOT (D9) ─────────

test("PIN (D9): use-pos-tab.ts's CREATE payload carries rewardAt", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  const createStart = src.indexOf("const buildCreatePayload");
  const createEnd = src.indexOf("const applyTabUpdate");
  assert.ok(createStart >= 0 && createEnd > createStart, "landmark: buildCreatePayload must be found and bounded by applyTabUpdate");
  const createSlice = src.slice(createStart, createEnd);
  assert.match(
    createSlice,
    /rewardAt:\s*reward\.pendingRewardAt,/,
    "buildCreatePayload must carry rewardAt: reward.pendingRewardAt",
  );
});

test("PIN (D9, SCOPED like receipt.test.ts's kitchenPayload pin): use-pos-tab.ts's ADD-ROUND payload (inside sendToKitchen) carries rewardAt — scoped between sendToKitchen and payNow so a file-wide needle cannot pass vacuously against the wrong block", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  const kitchenPayload = src.slice(
    src.indexOf("const sendToKitchen"),
    src.indexOf("const payNow"),
  );
  assert.match(
    kitchenPayload,
    /addItems\.mutateAsync/,
    "landmark: sendToKitchen must still fire the add-round via addItems.mutateAsync — without this the key assertion below could pass vacuously against an empty slice",
  );
  assert.match(
    kitchenPayload,
    /data:\s*\{[^}]*\brewardAt:\s*reward\.pendingRewardAt\b/,
    "the add-a-round payload must carry rewardAt: reward.pendingRewardAt — an open tab is exactly when the counter applies a reward, per the slice's own comment",
  );
});

test("PIN (D9): use-pos-tab.ts's SETTLE payload block does NOT carry rewardAt — the claim happens at order-taking time, settle refuses an item rung", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  // Positive landmark: the settle call site really exists and is the thing
  // being scoped, so the absence check below cannot pass vacuously against a
  // missing/renamed block.
  const settleCallIdx = src.indexOf("const updated = await settleOrder.mutateAsync({");
  assert.ok(settleCallIdx >= 0, "landmark: the settle mutateAsync call site must be found");
  // Scope to the settle call's own data block: from its opening brace to the
  // matching close, i.e. up to (and just past) the confirmPayment `else {`
  // that starts the create-branch that follows it.
  const elseIdx = src.indexOf("} else {", settleCallIdx);
  assert.ok(elseIdx > settleCallIdx, "landmark: the settle branch must be followed by the create-branch's `} else {`");
  const settleSlice = src.slice(settleCallIdx, elseIdx);
  assert.match(settleSlice, /paidAmount:\s*collectedAmount\(result\),/, "landmark: the settle payload must still carry paidAmount — confirms the slice bounds the right block");
  assert.ok(
    !/rewardAt/.test(settleSlice),
    "the settle payload must NOT carry rewardAt — D9: a reward claim happens at order-taking time (create/add-round), never at settle",
  );
});

// ── 5: pos-cart-props.ts threads every reward prop to BOTH cart mounts ──────

test("PIN: lib/pos-cart-props.ts's buildCartProps threads every reward prop (customerSelected, rewardLoading, stamps, rewardOffers, selectedRewardAt, rewardLocked, onSelectReward, manualDiscountActive) — one builder feeds BOTH the desktop Cart and the MobileCartBar sheet", () => {
  const src = stripComments(readSrc("lib/pos-cart-props.ts"));
  assert.match(src, /export function buildCartProps\(/, "landmark: buildCartProps must still be exported");
  const rewardKeys = [
    "customerSelected: !!pos.customer,",
    "rewardLoading: pos.rewardLoading,",
    "stamps: pos.stamps,",
    "rewardOffers: pos.rewardOffers,",
    "selectedRewardAt: pos.selectedRewardAt,",
    "rewardLocked: pos.rewardLocked,",
    "onSelectReward: pos.onSelectReward,",
    "manualDiscountActive: pos.manualDiscountActive,",
  ];
  for (const key of rewardKeys) {
    assert.ok(src.includes(key), `buildCartProps must include "${key}" — a reward prop threaded to only one cart mount is the bug this pins against`);
  }
});

// ── 6: REACHABILITY — CartReward and useRewardSelection are wired, not dead ──

test("PIN (REACHABILITY): CartReward is imported AND rendered (as JSX <CartReward ...>) in components/pos/Cart.tsx", () => {
  const src = stripComments(readSrc("components/pos/Cart.tsx"));
  assert.match(
    src,
    /import\s*\{\s*CartReward\s*\}\s*from\s*"@\/components\/pos\/CartReward"/,
    "Cart.tsx must import CartReward from @/components/pos/CartReward",
  );
  assert.match(src, /<CartReward\b/, "Cart.tsx must actually RENDER <CartReward — an import with no JSX use is a compiled-but-dead component");
});

test("PIN (REACHABILITY): useRewardSelection is imported AND called in hooks/use-pos-tab.ts", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  assert.match(
    src,
    /import\s*\{\s*useRewardSelection\s*\}\s*from\s*"@\/hooks\/use-customer-rewards"/,
    "use-pos-tab.ts must import useRewardSelection from @/hooks/use-customer-rewards",
  );
  assert.match(
    src,
    /const reward = useRewardSelection\(/,
    "use-pos-tab.ts must actually CALL useRewardSelection — an import with no call site is a compiled-but-dead hook",
  );
});

// ── 7: the selection READER is gated, not just the control ──────────────────

test("PIN: hooks/use-customer-rewards.ts's onSelectReward early-returns while locked — the READER is gated, not merely a disabled attribute upstream", () => {
  const src = stripComments(readSrc("hooks/use-customer-rewards.ts"));
  const fnStart = src.indexOf("const onSelectReward = (at: number | null) => {");
  assert.ok(fnStart >= 0, "landmark: onSelectReward must be defined with this exact signature");
  const fnEnd = src.indexOf("\n  };", fnStart);
  assert.ok(fnEnd > fnStart, "landmark: onSelectReward's closing must be found to bound its body");
  const fnBody = src.slice(fnStart, fnEnd);
  assert.match(
    fnBody,
    /if\s*\(locked\)\s*return;/,
    "onSelectReward must early-return `if (locked) return;` as its FIRST guard — a tap that slipped past a disabled attribute must still change nothing here",
  );
  // Positive landmark that this guard actually runs BEFORE any state write —
  // setRewardAt must not appear before the guard in this function body.
  const guardIdx = fnBody.indexOf("if (locked) return;");
  const firstSetIdx = fnBody.indexOf("setRewardAt(");
  assert.ok(firstSetIdx === -1 || guardIdx < firstSetIdx, "the locked guard must precede any setRewardAt call in onSelectReward");
});

test("PIN: components/pos/CartReward.tsx's RungButton onClick early-returns on !usable — 'disabled' alone is not a fence", () => {
  const src = stripComments(readSrc("components/pos/CartReward.tsx"));
  // Positive landmark: the disabled attribute really is ALSO wired (so this
  // pin is proving the reader-gate exists IN ADDITION to it, not instead).
  assert.match(src, /disabled=\{disabled\s*\|\|\s*!usable\}/, "landmark: the Button must still carry disabled={disabled || !usable}");
  const fnStart = src.indexOf("const handleClick = () => {");
  assert.ok(fnStart >= 0, "landmark: handleClick must be defined with this exact signature");
  const fnEnd = src.indexOf("\n  };", fnStart);
  assert.ok(fnEnd > fnStart, "landmark: handleClick's closing must be found to bound its body");
  const fnBody = src.slice(fnStart, fnEnd);
  assert.match(
    fnBody,
    /if\s*\(!usable\)\s*return;/,
    "handleClick must early-return `if (!usable) return;` as its FIRST guard — a stray Enter/Space keydown or a future caller that stops passing `disabled` through must still be refused HERE",
  );
});

// ── CB-5B S9 REGRESSION: the cart must PREVIEW a selected reward ─────────────
// THE BUG (found by adversarial review, arbitrated CONFIRMED-CRITICAL against a
// live probe): selecting a rung set `rewardAt` and zeroed the manual discount,
// but usePosTotals had no `reward` input at all — so the cart footer, the
// mobile bar and the payment modal all showed the UNDISCOUNTED total while the
// server stored the discounted one. On a Rs 500 bill with a Rs 100 flat rung
// the counter collected 500 against an order that recorded 400: the customer
// was overcharged and the till ran over against recorded sales, with nothing
// on screen to show it. A SPLIT payment was worse than wrong, it was
// impossible — PaymentModal only enables its CTA when splitCash + splitOnline
// equals ITS total (500), and the server then rejected that against its own
// total (400) with a hard 400.
//
// These pins are behavioural where they can be: the preview is only correct if
// it produces the SAME number the server's own computeOrderTotals does, so the
// assertion compares the two derivations rather than restating the arithmetic.

test("REGRESSION (S9): the client's reward preview equals the server's computeOrderTotals discount, for flat and percent, across subtotals", async () => {
  const { computeOrderTotals, rewardDiscountAmount } = await import("./receipt");
  const cfg = { gstEnabled: false, gstRate: 0, gstMode: "exclusive" as const };

  for (const subtotal of [100, 499, 500, 1000, 2345]) {
    for (const reward of [
      { at: 10, kind: "flat" as const, value: 100, item: "" },
      { at: 10, kind: "percent" as const, value: 20, item: "" },
      // A flat rung worth MORE than the bill must clamp to the bill, never
      // produce a negative total or a credit.
      { at: 10, kind: "flat" as const, value: 99999, item: "" },
    ]) {
      const server = computeOrderTotals({
        items: [{ price: subtotal, qty: 1 }],
        discount: 0,
        discountKind: "reward",
        charge: 0,
        cfg,
        reward,
      });
      // This is the exact expression hooks/use-pos-totals.ts evaluates for its
      // reward arm. If that hook stops calling the shared derivation, or stops
      // clamping, this diverges and the counter is back to collecting a figure
      // the bill does not agree with.
      const preview = Math.min(rewardDiscountAmount(subtotal, reward), subtotal);
      assert.equal(
        preview,
        server.discount,
        `reward preview must equal the server's discount (subtotal ${subtotal}, ${reward.kind} ${reward.value})`,
      );
      assert.equal(subtotal - preview, server.total, "and therefore the same payable total");
    }
  }
});

test("REGRESSION (S9): an ITEM reward previews a ZERO discount — its benefit is the free line, not rupees off", async () => {
  const { rewardDiscountAmount } = await import("./receipt");
  // Double-charging an item reward (once as a discount, once as a skipped
  // line) would UNDER-charge the customer by the dish's price. The staff cart
  // never holds the free line at all (the server appends it), so the local
  // subtotal is already the correct base and the discount arm must contribute
  // nothing.
  const itemReward = { at: 8, kind: "item" as const, value: 0, item: "Free Coffee" };
  assert.equal(rewardDiscountAmount(500, itemReward), 0);
  assert.equal(Math.min(rewardDiscountAmount(500, itemReward), 500), 0);
});

test("PIN (S9 REGRESSION): usePosTotals takes a `reward` input and derives it through the SHARED rewardDiscountAmount, ahead of the GST and manual arms", () => {
  const src = stripComments(readSrc("hooks/use-pos-totals.ts"));
  assert.match(src, /export function usePosTotals/, "landmark: use-pos-totals.ts must still export usePosTotals");

  // POSITIVE: the input exists on the interface, so a caller CAN pass it...
  assert.match(
    src,
    /reward\?:\s*RedeemedReward;/,
    "PosTotalsInput must declare `reward?: RedeemedReward` — without it the cart cannot preview a claimed rung and silently shows the undiscounted total",
  );
  // ...and is actually destructured and USED, not merely declared.
  assert.match(
    src,
    /rewardDiscountAmount\(subtotal,\s*reward\)/,
    "the reward arm must call the SHARED rewardDiscountAmount(subtotal, reward) — re-deriving the percent/flat math here is how the preview and the bill drift apart",
  );
  // ORDER MATTERS: a reward REPLACES the kind server-side (A2/D6), so its arm
  // must be evaluated BEFORE the GST preset, exactly as computeOrderTotals'
  // rawDiscount ladder does. An upper bound (the return) plus the relative
  // order, per this repo's ordering-pin rule.
  const rewardIdx = src.indexOf("rewardDiscountAmount(subtotal, reward)");
  const gstIdx = src.indexOf("gstEquivalentDiscount(subtotal, gstCfg)");
  const returnIdx = src.indexOf("total: base + gstAmount + clampedCharge");
  assert.ok(rewardIdx >= 0, "landmark: the reward arm must exist");
  assert.ok(gstIdx >= 0, "landmark: the GST arm must exist");
  assert.ok(returnIdx >= 0, "landmark: the totals return must exist");
  assert.ok(
    rewardIdx < gstIdx,
    "the reward arm must be evaluated BEFORE the GST arm — a claimed reward replaces the discountKind, so a GST preset left active must not win over it",
  );
  assert.ok(
    gstIdx < returnIdx,
    "both discount arms must precede the totals return (upper bound: this cannot be satisfied by dead code below the return)",
  );
  // The clamp is load-bearing: a flat rung worth more than the bill must not
  // drive the total negative.
  assert.match(
    src,
    /Math\.min\(rewardDiscountAmount\(subtotal,\s*reward\),\s*subtotal\)/,
    "the reward preview must be clamped to the subtotal, mirroring computeOrderTotals' own clampedDiscount",
  );
});

test("PIN (S9 REGRESSION): use-pos-tab.ts prices TWICE — a PRE-reward pass that gates minBill, then the shown totals carrying the selected reward", () => {
  const src = stripComments(readSrc("hooks/use-pos-tab.ts"));
  assert.match(src, /export function usePosTab/, "landmark: use-pos-tab.ts must still export usePosTab");

  // The pre-reward pass feeds the rung gate: a reward must never fund its own
  // minBill, which is exactly how the two server routes price it.
  assert.match(
    src,
    /useRewardSelection\(\s*customer,\s*plain\.total/,
    "useRewardSelection must be gated on the PRE-reward total (`plain.total`) — passing the post-reward total would let a reward fund its own minBill gate",
  );
  // ...and the figures every surface shows must carry the reward.
  assert.match(
    src,
    /reward:\s*reward\.selectedReward,/,
    "the displayed totals must be re-priced with reward.selectedReward — this is the line whose absence made the POS collect the undiscounted amount",
  );
  const plainIdx = src.indexOf("const plain = usePosTotals(");
  const selectionIdx = src.indexOf("useRewardSelection(");
  const shownIdx = src.indexOf("reward: reward.selectedReward,");
  assert.ok(plainIdx >= 0, "landmark: the pre-reward pricing pass must exist");
  assert.ok(
    plainIdx < selectionIdx && selectionIdx < shownIdx,
    "ordering: price plain -> resolve the selection against it -> re-price with the reward",
  );
});

// ── CB-5B S9 REGRESSION: the two HIGH findings from adversarial review ───────

test("REGRESSION (S9): an AMBIGUOUS rung is unusable with the claim gate's OWN reason, checked BEFORE the balance", () => {
  // THE BUG: normalizeMilestones DEDUPES a duplicate `at` and keeps the first
  // row, so a legacy ladder with two rows at 10 looks ordinary to the picker —
  // while the claim gate re-reads the RAW rows, finds two, and refuses with
  // "ambiguous-reward". pickDefaultRung takes the HIGHEST usable rung, so such
  // a rung was not merely offered, it was AUTO-SELECTED, and every create and
  // add-round 400'd: the counter could not take the order at all.
  const ambiguous: RewardRung = {
    at: 10, kind: "flat", value: 100, item: "", minBill: null,
    // A full card — affordable on stamps, and STILL refused. That ordering is
    // the point: reporting "not enough stamps" here would send a counter with
    // a full card chasing the wrong problem.
    affordable: true, ambiguous: true,
  };
  const [offer] = rungOffers([ambiguous], 1000);
  assert.equal(offer!.usable, false, "an ambiguous rung must never be usable");
  assert.equal(
    offer!.reason,
    rewardClaimMessage("ambiguous-reward"),
    "the counter must read the claim gate's own ambiguous-reward wording, not an affordability complaint",
  );
  assert.equal(
    pickDefaultRung(rungOffers([ambiguous], 1000)),
    undefined,
    "and it must never be AUTO-SELECTED — this is what made every order 400",
  );

  // Absent/false `ambiguous` must behave exactly as before (every well-formed
  // ladder), so the new gate cannot quietly disable working rungs.
  const clean: RewardRung = { ...ambiguous, ambiguous: false };
  assert.equal(rungOffers([clean], 1000)[0]!.usable, true);
  const legacyShape = { at: 10, kind: "flat" as const, value: 100, item: "", minBill: null, affordable: true };
  assert.equal(rungOffers([legacyShape], 1000)[0]!.usable, true, "an absent `ambiguous` must read as not-ambiguous");
});

test("PIN (S9 REGRESSION): the rewards route marks a duplicated `at` NOT affordable, mirroring findMilestoneAt's RAW duplicate check", () => {
  const src = stripComments(readSrc("app/api/customers/[id]/rewards/route.ts"));
  assert.match(src, /resolveLoyaltyConfig\(settings\)/, "landmark: the route must still resolve the ladder");
  // It must count the RAW stored rows — the normalized ladder has already
  // deduped them, so counting THAT would never see a duplicate.
  assert.match(
    src,
    /settings\?\.loyaltyRules\?\.milestones/,
    "the duplicate check must read the RAW stored milestones — the normalized ladder is already deduped and can never reveal one",
  );
  assert.match(
    src,
    /affordable:\s*stamps\s*>=\s*m\.at\s*&&\s*\(rawAtCounts\.get\(m\.at\)\s*\?\?\s*0\)\s*<=\s*1/,
    "affordable must require BOTH the stamp balance and non-ambiguity",
  );
  assert.match(
    src,
    /ambiguous:\s*\(rawAtCounts\.get\(m\.at\)\s*\?\?\s*0\)\s*>\s*1/,
    "the route must report `ambiguous` separately so the picker can give the owner-actionable reason",
  );
});

test("PIN (S9 REGRESSION): the auto-default NEVER arms a reward while a manual discount is active, and the payload fences it independently", () => {
  const src = stripComments(readSrc("hooks/use-customer-rewards.ts"));
  assert.match(src, /export function useRewardSelection/, "landmark: use-customer-rewards.ts must still export useRewardSelection");

  // ONE derivation, hoisted above the effect — two copies could disagree.
  assert.match(
    src,
    /const manualDiscountActive = discountRaw > 0 \|\| discountUnit === "GST";/,
    "manualDiscountActive must be derived ONCE, above the effect that consumes it",
  );
  const declIdx = src.indexOf("const manualDiscountActive =");
  const effectIdx = src.indexOf("useEffect(");
  assert.ok(declIdx >= 0 && effectIdx >= 0, "landmarks: the predicate and the effect must both exist");
  assert.ok(declIdx < effectIdx, "the predicate must be declared BEFORE the effect that guards on it");

  // The effect stands down (and disarms an already-armed pick).
  const effectBody = src.slice(effectIdx, src.indexOf("}, [rewardOffers"));
  assert.match(
    effectBody,
    /if\s*\(manualDiscountActive\)\s*\{/,
    "the auto-default effect must guard on manualDiscountActive — auto-arming behind a typed discount spends the customer's stamps for a discount the bill never shows, and CartReward hides the selection in that state",
  );
  assert.match(
    effectBody,
    /setRewardAt\(null\)/,
    "an ALREADY-armed auto-pick must be stood down when a discount appears, not merely left unrenewed",
  );
  assert.match(
    src,
    /\}, \[rewardOffers, rewardAt, setRewardAt, locked, manualDiscountActive\]\);/,
    "manualDiscountActive must be in the dep array, or the effect reads a stale value",
  );

  // DEFENCE IN DEPTH: the effect runs AFTER a render, so the payload must fence
  // the same rule at the moment it is built.
  assert.match(
    src,
    /pendingRewardAt:\s*locked \|\| manualDiscountActive \? undefined : rewardAt \?\? undefined,/,
    "pendingRewardAt must refuse a reward while a manual discount is active — the effect is a behaviour, not a fence, and there is a window between the two",
  );
  assert.match(
    src,
    /selectedReward:\s*locked \|\| manualDiscountActive/,
    "the money PREVIEW must be suppressed in the same state, or the cart shows a reward discount the payload will not carry",
  );
});

// ── CB-5B S14: the reward flag must survive the PRINT contract ───────────────
// THE DEPLOY BLOCKER this closes: printOrderSnapshotItemSchema is `.strict()`
// and carried no `reward`/`note` key, so a reward order's snapshot was REJECTED
// outright — a host-printed KOT never reached the kitchen and nobody was told
// about the free dish. OWNER DECISION (2026-09-14): the KOT itself stays a
// NORMAL KOT (product + price, exactly like any other line); the whole feature
// is managed by the ONE `reward` flag, which only the billing subtotal reads.

test("S14: a reward line SURVIVES printOrderSnapshot + the strict schema parse, carrying reward + note", async () => {
  const { printOrderSnapshot } = await import("@pos/shared/print-job");
  const { printOrderSnapshotSchema } = await import("@pos/shared/schemas/print-job.schema");

  const order = {
    _id: "1", orderId: "ORD-1", customerName: "Walk-In",
    items: [
      { productId: "p1", name: "Tea", price: 100, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
      { productId: "p2", name: "Cake", price: 180, qty: 1, modifiers: [], instructions: "", kotRound: 1,
        reward: true as const, note: "Reward — free" },
    ],
    subtotal: 100, discount: 0, discountKind: "reward" as const, total: 100,
    paidAmount: 100, payment: "Cash" as const, status: "Completed" as const,
    receiver: "staff", kotRounds: 1, createdAt: new Date().toISOString(),
  };

  const snap = printOrderSnapshot(order as never);
  const parsed = printOrderSnapshotSchema.safeParse(snap);
  assert.equal(
    parsed.success,
    true,
    `the strict parse must ACCEPT a reward order — this exact rejection was the deploy blocker. ${
      parsed.success ? "" : JSON.stringify(parsed.error.issues)
    }`,
  );

  // The flag and its marker must actually ARRIVE — a schema that merely PERMITS
  // a field the pick never carries is the synthesized-line trap (a new field
  // declared everywhere and silently never printed).
  assert.equal(snap.items[1]!.reward, true, "the reward flag must reach the snapshot");
  assert.equal(snap.items[1]!.note, "Reward — free", "the stored marker must reach the snapshot");

  // OMIT-EMPTY on an ordinary line: no dead keys on every normal item.
  assert.ok(!("reward" in snap.items[0]!), "an ordinary line must carry NO reward key at all");
  assert.ok(!("note" in snap.items[0]!), "an ordinary line must carry NO note key at all");

  // The KOT stays NORMAL: the reward line keeps its REAL price, so the kitchen
  // ticket prints it exactly like any other dish (the owner's requirement).
  assert.equal(snap.items[1]!.price, 180, "the reward line must keep its real price for the kitchen ticket");
});

test("S14: the ONE flag is what removes the money — 5 items, 1 reward, its amount off the bill and untaxed", async () => {
  const { computeOrderTotals } = await import("./receipt");
  const items = [
    { price: 100, qty: 1 }, { price: 150, qty: 1 }, { price: 200, qty: 1 }, { price: 120, qty: 1 },
    { price: 180, qty: 1, reward: true as const },
  ];
  const gross = items.reduce((s, i) => s + i.price * i.qty, 0);
  const cfg = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" as const };
  const t = computeOrderTotals({
    items, discount: 0, discountKind: "reward", charge: 0, cfg,
    reward: { at: 8, kind: "item", value: 0, item: "Cake" },
  });
  assert.equal(gross, 750, "sanity: all five lines at face value");
  assert.equal(t.subtotal, 570, "the flagged line's 180 must be OFF the subtotal");
  assert.equal(t.discount, 0, "an item reward is NOT a rupee discount — its benefit is the excluded line");
  // UNTAXED follows from the same single skip: tax is computed on the reduced
  // base, so the customer is never charged GST on a dish they were given.
  assert.equal(t.gstAmount, Math.round(570 * 0.05), "GST must be charged on the REDUCED base, never on the free dish");
});

test("PIN (S14): printOrderSnapshot CARRIES reward/note through the item pick, omit-empty", () => {
  const src = stripComments(readSrc("../../packages/shared/src/print-job.ts"));
  assert.match(src, /export function printOrderSnapshot/, "landmark: printOrderSnapshot must still exist");
  assert.match(
    src,
    /\.\.\.\(item\.reward === true \? \{ reward: true as const \} : \{\}\)/,
    "the pick must forward `reward` omit-empty — a schema that permits a field the pick drops prints nothing",
  );
  assert.match(
    src,
    /\.\.\.\(item\.note \? \{ note: item\.note \} : \{\}\)/,
    "the pick must forward the stored `note` omit-empty",
  );
});

test("PIN (S14): the strict print item schema declares reward + note, and the KOT renderer stays UNCHANGED (no reward branch)", () => {
  const schemaSrc = stripComments(readSrc("../../packages/shared/src/schemas/print-job.schema.ts"));
  assert.match(schemaSrc, /printOrderSnapshotItemSchema\s*=\s*z\.object\(/, "landmark: the item schema must still be defined");
  assert.match(schemaSrc, /reward:\s*z\.literal\(true\)\.optional\(\)/, "the item schema must permit `reward`");
  assert.match(schemaSrc, /note:\s*z\.string\(\)\.optional\(\)/, "the item schema must permit `note`");
  assert.match(schemaSrc, /\}\)\.strict\(\)/, "landmark: it must still be .strict() — widening must not have been bought by dropping the fence");

  // OWNER DECISION, pinned as an ABSENCE with a positive landmark: the kitchen
  // ticket must keep printing a reward line like any other line. A future edit
  // that special-cases it here would be a regression against an explicit ask.
  const kot = stripComments(readSrc("components/pos/KOTReceipt.tsx"));
  assert.match(kot, /\{item\.qty\} × \{orderItemLabel\(item\)\}/, "landmark: the KOT must still render the ordinary qty × name line");
  assert.ok(
    !/item\.reward/.test(kot),
    "the KOT must NOT branch on item.reward — the owner's requirement is that a kitchen ticket stays a normal ticket (product + price); the flag exists for BILLING only",
  );
});

test("PIN (S14): the BILL marks a reward line FREE, so the printed amounts add up to the printed total", () => {
  // Without this the bill printed the free dish at its real price while the
  // subtotal below excluded it — a bill that visibly does not add up in the
  // customer's hands.
  const src = stripComments(readSrc("components/pos/OrderReceipt.tsx"));
  assert.match(src, /orderItemLabel\(item\)/, "landmark: the bill must still render item labels");
  assert.match(
    src,
    /item\.reward \?/,
    "the bill must branch on the stored reward flag for the amount column",
  );
  assert.match(src, /FREE/, "a reward line's amount column must read FREE");
  assert.match(
    src,
    /line-through/,
    "the dish's worth must still be shown (struck through) — the customer should see what they were given",
  );
});
