/**
 * Loyalty rules (CB-5A) live leg — proves DB-truth the DB-free unit tests
 * cannot: that a route-shaped full loyaltyRules save round-trips every key
 * through a REAL MongoDB, that a ""-legal string sub-field (a flat-kind
 * milestone's `item`) never trips Mongoose `required` and 500s the save (the
 * exact hazard the appearance/promoCodes precedent already documents), that
 * a loyalty-section-shaped PUT (pickSectionValues' own output) really leaves
 * every sibling top-level field untouched and vice-versa, that a raw partial
 * nested $set on loyaltyRules does whatever Mongoose's $isSingleNested
 * replace semantics actually do (proved, not assumed, and reported either
 * way — mirrors scripts/verify-appearance-live.ts's A15a scenario one field
 * over), that updateSettingsSchema's version gate holds against a real
 * parse, that an absent loyaltyRules truly never materializes onto a fresh
 * upsert (the `default: undefined` discipline), and that a live cafe
 * carrying only the legacy CB-4 flat fields resolves through
 * resolveLoyaltyConfig/dinerStampCard EXACTLY as it did before CB-5A shipped.
 *
 * CB-5D (owner, 2026-09-15): `levels` and `membership` are REMOVED from
 * loyaltyRulesSchema — no client used either. Every fixture/scenario below
 * that exercised them is trimmed to the surviving milestones/unitLabel/
 * cardSize/v shape.
 *
 *   npm run verify:loyalty-rules:live          (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_loyalty npm run verify:loyalty-rules:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the Settings collection it touches at the end.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Settings, type ISettings } from "@/models/Settings";
import { readSettings, invalidateSettingsCache } from "@/lib/settings";
import { updateSettingsSchema } from "@/schemas";
import { resolveLoyaltyConfig, dinerStampCard } from "@/lib/diner-loyalty";
import { LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import type { LoyaltyRulesInput } from "@pos/shared/schemas/settings-loyalty.schema";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}loyalty`;

// A full loyaltyRules object with every key populated — two milestones (one
// WITH minBill, one WITHOUT, per the S8 spec). Deliberately not the schema's
// own default shape so a round-trip that silently fell back to defaults
// cannot pass by accident.
const FULL_RULES: LoyaltyRulesInput = {
  v: LOYALTY_RULES_SCHEMA_VERSION,
  unitLabel: "coffee bean",
  milestones: [
    { at: 5, kind: "percent", value: 10, item: "", minBill: 200 },
    { at: 10, kind: "flat", value: 50, item: "" },
  ],
};

// The ""-sentinel fixture (scenario 2): the one string field that is legal
// empty per settings.subschemas.ts's own comments — a flat-kind milestone's
// `item`.
const EMPTY_SENTINEL_RULES: LoyaltyRulesInput = {
  v: LOYALTY_RULES_SCHEMA_VERSION,
  unitLabel: "stamp",
  milestones: [{ at: 8, kind: "flat", value: 50, item: "" }],
};

let passed = 0;
let failed = 0;

async function scenario(n: number, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${n}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${n}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function reset(): Promise<void> {
  await Settings.collection.deleteMany({});
  invalidateSettingsCache();
}

// The EXACT shape app/api/settings/route.ts's PUT handler uses: parse through
// updateSettingsSchema, then findOneAndUpdate with Mongoose's own auto-$set
// behavior (no operator wrapper of our own), same as production.
async function routeShapedUpdate(candidate: unknown): Promise<void> {
  const parsed = updateSettingsSchema.safeParse(candidate);
  assert.ok(
    parsed.success,
    `fixture candidate must itself parse: ${!parsed.success ? JSON.stringify(parsed.error.flatten()) : ""}`,
  );
  await Settings.findOneAndUpdate({}, parsed.data, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean();
  invalidateSettingsCache();
}

async function readRawDoc(): Promise<Record<string, unknown> | null> {
  return (await Settings.findOne().lean()) as Record<string, unknown> | null;
}

async function readLoyaltyRulesField(): Promise<LoyaltyRulesInput | null> {
  const doc = (await Settings.findOne().lean()) as ISettings | null;
  return (doc?.loyaltyRules as LoyaltyRulesInput | undefined) ?? null;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await Settings.collection.drop().catch(() => undefined);
  await Settings.createIndexes();

  console.log(`\nloyalty rules settings live — live against ${dbName}\n`);

  try {
    await scenario(
      1,
      "route-shaped full save round-trips every loyaltyRules key (multi-milestone ladder incl. a minBill-less row) through a REAL Settings.findOneAndUpdate",
      async () => {
        await reset();
        await routeShapedUpdate({ loyaltyRules: FULL_RULES });
        const stored = await readLoyaltyRulesField();
        assert.deepEqual(stored, FULL_RULES, "every key of the saved loyaltyRules object must round-trip unchanged");
        assert.equal(stored?.milestones[0].minBill, 200, "the milestone WITH minBill must keep it");
        assert.equal(stored?.milestones[1].minBill, undefined, "the milestone WITHOUT minBill must stay absent, not null/0");
      },
    );

    await scenario(
      2,
      'THE ""-SENTINEL TEST: milestone item saved as "" where legal must SUCCEED — a Mongoose `required` regression on that path would 500 this save',
      async () => {
        await reset();
        let threw: unknown = null;
        try {
          await routeShapedUpdate({ loyaltyRules: EMPTY_SENTINEL_RULES });
        } catch (error) {
          threw = error;
        }
        assert.equal(threw, null, `an empty-string-legal loyaltyRules save must not throw: ${threw instanceof Error ? threw.message : String(threw)}`);
        const stored = await readLoyaltyRulesField();
        assert.equal(stored?.milestones[0].item, "", "flat-kind milestone item must read back as empty string");
      },
    );

    await scenario(
      3,
      "THE ANTI-CLOBBER TEST: a loyalty-section-shaped PUT (pickSectionValues' own output) leaves every sibling top-level field untouched",
      async () => {
        await reset();
        await routeShapedUpdate({
          restaurantName: "Test Cafe",
          gstEnabled: true,
          gstRate: 18,
          gstNumber: "GSTIN123",
          promoCodes: [{ code: "SAVE10", kind: "percent", value: 10, active: true }],
          appearance: {
            v: 1,
            presetId: "classicBistro",
            accentOverride: "",
            fontPairKey: "classic",
            cornerRadius: "round",
            density: "roomy",
            logoPlacement: "center",
            heroImage: "",
          },
          telegramPaused: true,
        });
        const before = await readRawDoc();
        assert.equal(before?.restaurantName, "Test Cafe");
        assert.ok(before?.appearance, "setup must land an appearance subdoc before the loyalty-only PUT");

        // Exactly what pickSectionValues(values, loyaltySection) produces: the
        // loyalty section's own field list, loyaltyRules included.
        await routeShapedUpdate({
          dinerAccountsEnabled: true,
          loyaltyEnabled: true,
          loyaltyStampsPerReward: 8,
          loyaltyMinBill: 100,
          loyaltyRewardKind: "flat",
          loyaltyRewardValue: 50,
          loyaltyRewardItem: "",
          loyaltyRules: FULL_RULES,
        });

        const after = await readRawDoc();
        assert.equal(after?.restaurantName, "Test Cafe", "restaurantName must survive a loyalty-only PUT");
        assert.equal(after?.gstEnabled, true, "gstEnabled must survive a loyalty-only PUT");
        assert.equal(after?.gstRate, 18, "gstRate must survive a loyalty-only PUT");
        assert.equal(after?.gstNumber, "GSTIN123", "gstNumber must survive a loyalty-only PUT");
        assert.equal((after?.promoCodes as unknown[] | undefined)?.length, 1, "promoCodes must survive a loyalty-only PUT");
        assert.ok(after?.appearance, "appearance must survive a loyalty-only PUT");
        assert.equal(after?.telegramPaused, true, "telegramPaused must survive a loyalty-only PUT");
        assert.deepEqual(after?.loyaltyRules, FULL_RULES, "loyaltyRules itself must be the newly saved value");

        // Reverse direction: an appearance-only PUT must leave loyaltyRules intact.
        await routeShapedUpdate({
          appearance: {
            v: 1,
            presetId: "freshMint",
            accentOverride: "",
            fontPairKey: "classic",
            cornerRadius: "round",
            density: "roomy",
            logoPlacement: "center",
            heroImage: "",
          },
        });
        const afterAppearanceOnly = await readRawDoc();
        assert.deepEqual(
          afterAppearanceOnly?.loyaltyRules,
          FULL_RULES,
          "loyaltyRules must be untouched by an appearance-only PUT",
        );
      },
    );

    await scenario(
      4,
      "NESTED REPLACE SEMANTICS, PROVED not assumed: a raw partial loyaltyRules $set (bypassing Zod, missing the `unitLabel` sub-key) either WIPES the rest of the subdoc (whole-replace) or is REJECTED by Mongoose's own required-path validators — assert whichever the DB actually does, and report it",
      async () => {
        await reset();
        await routeShapedUpdate({ loyaltyRules: FULL_RULES });
        const before = await readLoyaltyRulesField();
        assert.deepEqual(before, FULL_RULES, "setup must land the full loyaltyRules object before the probe");

        // Deliberately typed `as LoyaltyRulesInput` to bypass Zod's own
        // all-keys gate (the route's real fence) — no `any`, a narrow cast to
        // the exact target type the model schema expects, commented because
        // it is intentionally missing `unitLabel`.
        const partialCandidate = {
          v: LOYALTY_RULES_SCHEMA_VERSION,
          milestones: FULL_RULES.milestones,
        } as LoyaltyRulesInput;

        let rejected = false;
        try {
          await Settings.findOneAndUpdate(
            {},
            { loyaltyRules: partialCandidate },
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
          );
        } catch (error) {
          rejected = true;
          assert.ok(
            error instanceof mongoose.Error.ValidationError,
            "a rejection must be a genuine Mongoose ValidationError, not some other failure mode",
          );
        }
        invalidateSettingsCache();

        const after = await readLoyaltyRulesField();
        if (rejected) {
          console.log(
            "       (probed truth: Mongoose's required-path validators reject a partial loyaltyRules subdoc outright — unitLabel has no `required:true` per settings.subschemas.ts, so THIS repo's actual behaviour is the else-branch below; a rejection here would mean that comment is stale)",
          );
          assert.deepEqual(after, FULL_RULES, "a rejected update must leave the prior loyaltyRules object completely untouched");
        } else {
          console.log(
            "       (probed truth: $set replaced the loyaltyRules subdoc WHOLE — unitLabel silently reverted to Mongoose's schema default/undefined, proving the Zod all-keys rule on loyaltyRulesSchema is load-bearing, not decorative)",
          );
          assert.deepEqual(after?.milestones, FULL_RULES.milestones, "the fields the partial candidate DID carry must be present");
          assert.notEqual(
            after?.unitLabel,
            FULL_RULES.unitLabel,
            "the omitted unitLabel must NOT survive a whole-subdoc replace — this is the exact clobber the one-section-ownership design depends on",
          );
        }
      },
    );

    await scenario(5, "VERSION GATE: loyaltyRules.v !== LOYALTY_RULES_SCHEMA_VERSION is REJECTED by updateSettingsSchema before it ever reaches the DB", () => {
      // CB-5D bumped LOYALTY_RULES_SCHEMA_VERSION to 2 — the fixture's stale
      // version must stay a version the schema does NOT accept, so this
      // probe always sends CURRENT + 1, never a hardcoded literal that can
      // silently become current again on the next version bump.
      const staleVersion = LOYALTY_RULES_SCHEMA_VERSION + 1;
      const parsed = updateSettingsSchema.safeParse({ loyaltyRules: { ...FULL_RULES, v: staleVersion } });
      assert.equal(parsed.success, false, "a stale/future loyaltyRules schema version must not silently parse");
      return Promise.resolve();
    });

    await scenario(
      6,
      "ABSENT STAYS ABSENT: upserting a fresh Settings doc with no loyaltyRules at all must NOT materialize an empty loyaltyRules object onto it",
      async () => {
        await reset();
        await routeShapedUpdate({ restaurantName: "Fresh Cafe" });
        const raw = await readRawDoc();
        assert.equal(Object.hasOwn(raw ?? {}, "loyaltyRules"), false, "a Settings doc that never mentioned loyaltyRules must have NO loyaltyRules key at all");
      },
    );

    await scenario(
      7,
      "FORWARD-MIGRATION ON REAL DATA: a doc carrying ONLY the 7 legacy CB-4 flat fields (today's live shape) resolves through resolveLoyaltyConfig + dinerStampCard IDENTICALLY to pre-CB-5A behaviour",
      async () => {
        await reset();
        await routeShapedUpdate({
          dinerAccountsEnabled: true,
          loyaltyEnabled: true,
          loyaltyStampsPerReward: 8,
          loyaltyMinBill: 100,
          loyaltyRewardKind: "flat",
          loyaltyRewardValue: 50,
          loyaltyRewardItem: "",
        });
        const raw = await readRawDoc();
        assert.equal(Object.hasOwn(raw ?? {}, "loyaltyRules"), false, "setup sanity: this doc must genuinely carry no loyaltyRules");

        const settings = await readSettings();
        const config = resolveLoyaltyConfig(settings);
        assert.equal(config.ladder.cycleLength, 8, "cycleLength must equal loyaltyStampsPerReward with exactly one derived milestone");
        assert.equal(config.ladder.milestones.length, 1, "the legacy derivation must produce exactly ONE milestone");

        // 5 stamps in, 3 away from the reward — the exact pre-CB-5A shape
        // stampsRemaining/rewardsAvailable always produced for this input.
        const card = dinerStampCard(5, 5, config);
        assert.equal(card.toNextReward, 3, "toNextReward must match the original flat-field math (8 - 5)");
        assert.equal(card.rewardsReady, 0, "rewardsReady must be 0 with only 5 of 8 stamps");
        assert.equal(card.stampsPerReward, 8);

        // stampsRemaining/rewardsAvailable read a boundary as "a FRESH full
        // card just started, not zero left" — pinned already by
        // packages/shared/src/public-diner.test.ts's own "exactly one full
        // card" case (stampsRemaining(8,8)===8, rewardsAvailable(8,8)===1).
        // Re-measured here rather than assumed: an initial draft of this
        // scenario asserted toNextReward===0 at the boundary and that
        // assertion itself was WRONG (it failed against the real code, not
        // the other way round) — this is the corrected, measured expectation.
        const readyCard = dinerStampCard(16, 16, config);
        assert.equal(readyCard.toNextReward, 8, "a diner exactly on a cycle boundary must show a FULL fresh card to the next reward, per the existing stampsRemaining boundary pin");
        assert.equal(readyCard.rewardsReady, 2, "16 stamps at cycleLength 8 must show 2 full rewards ready");
      },
    );

    await scenario(
      8,
      "EMPTY MILESTONES: loyaltyRules.milestones === [] resolves through the diner card with no NaN and no zero-length division — stampsPerReward falls back to the flat field",
      async () => {
        await reset();
        await routeShapedUpdate({
          loyaltyStampsPerReward: 8,
          loyaltyRewardKind: "flat",
          loyaltyRewardValue: 50,
          loyaltyRewardItem: "",
          loyaltyRules: { ...FULL_RULES, milestones: [] },
        });
        const settings = await readSettings();
        const config = resolveLoyaltyConfig(settings);
        assert.equal(config.ladder.cycleLength, 0, "an empty milestones array must produce cycleLength 0 on the ladder itself");
        assert.equal(config.stampsPerReward, 8, "stampsPerReward must fall back to the flat loyaltyStampsPerReward field (the `||` fallback in resolveLoyaltyConfig)");

        const card = dinerStampCard(5, 5, config);
        assert.equal(Number.isNaN(card.toNextReward), false, "toNextReward must never be NaN with an empty ladder");
        assert.equal(Number.isNaN(card.rewardsReady), false, "rewardsReady must never be NaN with an empty ladder");
        assert.equal(card.cyclePosition, 0, "ladderProgress must report cyclePosition 0 for a cycleLength<=0 ladder, never divide by zero");
        assert.equal(card.reachedThisCycle, 0);
      },
    );
  } finally {
    await Settings.collection.drop().catch(() => undefined);
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
