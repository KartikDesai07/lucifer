import { test } from "node:test";
import assert from "node:assert/strict";
import type { Schema } from "mongoose";

import { Customer, customerSchema } from "@/models/Customer";
import { rewardCardSchema } from "@/models/customer-reward-card";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";
import { buildCardSnapshot } from "@pos/shared/reward-levels-engine";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";

// CB-7 S1: the card subschema declares EVERY RewardCardSnapshot path (strict mode drops an undeclared one
// silently), the two arrays are select:false, and nothing carries a TTL. DB-free: documents are built and
// toObject()-ed, never saved. The DB-truth (CAS shapes, casting, BSON size) is verify:reward-levels:live.

const NOW = new Date("2026-10-08T06:30:00.000Z");
const FIXED_RNG = () => 0;

// A card from the real engine, then every optional field a REVEALED / USED / points card gains set by hand, so
// every RewardCardSnapshot key is present at once.
function fullCard(): RewardCardSnapshot {
  const built = buildCardSnapshot({
    id: "0123456789ab",
    issueKey: "step:7",
    source: "level",
    level: 1,
    step: 7,
    campaignId: "camp1",
    title: "Festival box",
    slot: {
      scratchDays: 7,
      useDays: 14,
      options: [
        { id: "o1", kind: "product-percent", weight: 2, min: 10, max: 20, productId: "a".repeat(24), productName: "Cold coffee", capRupees: 80, minBill: 200 },
        { id: "o2", kind: "none", weight: 1, label: "Better luck next time" },
      ],
    },
    rng: FIXED_RNG,
    now: NOW,
  });
  return {
    ...built,
    categoryId: "b".repeat(24),
    categoryName: "Beverages",
    qty: 1,
    label: "Better luck next time",
    revealedAt: new Date(NOW.getTime() + 1000),
    validUntil: new Date(NOW.getTime() + 86_400_000),
    usedAt: new Date(NOW.getTime() + 2000),
    orderId: "A-2026-0001",
    pointsSpent: 5,
  };
}

// Exhaustive by construction: `Record<keyof RewardCardSnapshot, true>` fails tsc when a field is added to the type
// and not listed here (or listed here and removed from the type). The three checks below then tie the list to the
// schema and to the fixture, so a field added to the type alone can no longer pass quietly.
const CARD_KEYS: Record<keyof RewardCardSnapshot, true> = {
  id: true,
  issueKey: true,
  source: true,
  level: true,
  step: true,
  campaignId: true,
  title: true,
  optionId: true,
  kind: true,
  value: true,
  productId: true,
  productName: true,
  categoryId: true,
  categoryName: true,
  qty: true,
  capRupees: true,
  minBill: true,
  label: true,
  pool: true,
  issuedAt: true,
  scratchBy: true,
  revealedAt: true,
  validUntil: true,
  usedAt: true,
  keepUntil: true,
  useDays: true,
  status: true,
  orderId: true,
  pointsSpent: true,
};
const CARD_KEY_LIST = Object.keys(CARD_KEYS);

const objectOf = (card: RewardCardSnapshot) =>
  new Customer({ name: "N", mobile: "9999999999", rewardCards: [card] }).toObject() as unknown as { rewardCards?: RewardCardSnapshot[] };

test("every RewardCardSnapshot key survives new Customer({rewardCards}).toObject(), field for field", () => {
  const card = fullCard();
  const out = objectOf(card).rewardCards;
  assert.ok(out && out.length === 1, "the card is on the document");
  const keys = Object.keys(card) as (keyof RewardCardSnapshot)[];
  assert.ok(keys.length > 20, "landmark: the checked key list is not trivially short");
  for (const k of ["keepUntil", "pool", "pointsSpent", "issueKey", "validUntil", "orderId"] as const) {
    assert.ok(keys.includes(k), `landmark: the card carries ${k}`);
  }
  for (const key of keys) assert.deepEqual(out[0][key], card[key], `${String(key)} survived`);
  assert.deepEqual(Object.keys(out[0]).sort(), keys.slice().sort(), "and nothing extra appeared");
});

test("the rewardCardSchema paths cover every RewardCardSnapshot key (the strict-mode pair)", () => {
  const declared = new Set(Object.keys(rewardCardSchema.paths));
  for (const key of Object.keys(fullCard())) assert.ok(declared.has(key), `${key} is declared on rewardCardSchema`);
});

test("CARD_KEYS, the schema and the fixture agree both ways (a field added to the type alone fails here)", () => {
  assert.ok(CARD_KEY_LIST.length > 20, "landmark: the key list is not trivially short");
  for (const key of CARD_KEY_LIST) assert.notEqual(rewardCardSchema.path(key), undefined, `${key} is a declared path of rewardCardSchema`);
  // Top level only: the pool subschema's own paths are reported as "pool.<field>" and are not card keys.
  const topLevel = Object.keys(rewardCardSchema.paths).filter((p) => !p.startsWith("pool."));
  assert.ok(topLevel.includes("pool"), "landmark: the walk saw the pool array");
  for (const path of topLevel) {
    if (path === "_id" || path === "__v") continue; // Mongoose's own bookkeeping, not card fields
    assert.ok(path in CARD_KEYS, `${path} is on the schema but not on RewardCardSnapshot`);
  }
  const fixture = new Set(Object.keys(fullCard()));
  for (const key of CARD_KEY_LIST) assert.ok(fixture.has(key), `fullCard() carries ${key}, so the round-trip covers it`);
});

test("an undeclared key on a card is dropped by strict mode (landmark for the pair above)", () => {
  const out = objectOf({ ...fullCard(), sneaky: "x" } as RewardCardSnapshot).rewardCards;
  assert.ok(out && out[0].id === "0123456789ab");
  assert.equal("sneaky" in out[0], false);
});

test("rewardCards and cardStepOrders are select:false; rewardsAnchorAt and cardSteps are not", () => {
  assert.equal(customerSchema.path("rewardCards").options.select, false);
  assert.equal(customerSchema.path("cardStepOrders").options.select, false);
  assert.equal(Customer.schema.path("rewardCards").options.select, false);
  assert.equal(Customer.schema.path("cardStepOrders").options.select, false);
  assert.notEqual(customerSchema.path("rewardsAnchorAt").options.select, false);
  assert.notEqual(customerSchema.path("cardSteps").options.select, false);
});

test("omit-empty: a fresh Customer stores none of the four reward keys (default undefined)", () => {
  const obj = new Customer({ name: "N", mobile: "9999999999" }).toObject() as unknown as Record<string, unknown>;
  assert.ok("visits" in obj, "landmark: ordinary defaults still apply");
  for (const k of ["rewardsAnchorAt", "cardSteps", "cardStepOrders", "rewardCards"]) assert.equal(k in obj, false, `${k} absent`);
});

test("an invalid kind / status / source on a card fails validation (enums are the shared tuples)", () => {
  for (const bad of [{ kind: "free-lunch" }, { status: "void" }, { source: "friend" }]) {
    const c = new Customer({ name: "N", mobile: "9999999999", rewardCards: [{ ...fullCard(), ...bad }] });
    assert.ok(c.validateSync(), `rejects ${JSON.stringify(bad)}`);
  }
  assert.equal(new Customer({ name: "N", mobile: "9999999999", rewardCards: [fullCard()] }).validateSync(), undefined, "landmark: the good card validates");
});

// Walk every Date path (and the pool subschema) of the card subschema: none may carry `expires`.
function datePathsOf(schema: Schema): { path: string; expires: unknown }[] {
  return Object.entries(schema.paths)
    .filter(([, p]) => p.instance === "Date")
    .map(([path, p]) => ({ path, expires: (p.options as { expires?: unknown }).expires }));
}

test("no Date path of the card subschema carries expires (the platform allows exactly one TTL)", () => {
  const dates = datePathsOf(rewardCardSchema);
  assert.ok(dates.length >= 6, `landmark: the walk found the card's Date paths (${dates.length})`);
  for (const d of dates) assert.equal(d.expires, undefined, `${d.path} has no expires`);
  assert.equal(rewardCardSchema.indexes().length, 0, "and the card subschema declares no index at all");
});

test("the registry TTL guard still passes for Customer (rewardCards declares no TTL index)", () => {
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Customer", customerSchema));
  assert.ok(customerSchema.indexes().length >= 1, "landmark: the guard saw Customer's real indexes (mobile unique, name text)");
});
