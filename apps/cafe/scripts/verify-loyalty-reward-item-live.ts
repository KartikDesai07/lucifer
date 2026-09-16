/**
 * CB-5B D8/D11 — live-DB leg for the free-dish reward milestone.
 *
 * WHY THIS EXISTS: session 33's adversarial review found that
 * `itemProductId` and `qty` were declared on the Zod schema and registered in
 * the settings form, but NOT on the Mongoose milestone subschema — so
 * `strict: true` silently dropped both on every save. Zod passed, the PUT
 * returned 200, the UI showed success, and nothing was stored. tsc, eslint and
 * 2174 unit tests were all green over it: a DB-free suite structurally cannot
 * see a field that Mongoose discards on write.
 *
 * So these scenarios go through the ROUTE'S EXACT SHAPE (the same
 * `updateSettingsSchema.safeParse` + the same `Settings.findOneAndUpdate`
 * option set as app/api/settings/route.ts) against a real mongod, and read
 * back what actually landed.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_reward npm run verify:reward-item:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops what it touches. Prints pass/fail only.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Settings, type ISettings } from "@/models/Settings";
import { Product } from "@/models/Product";
import { readSettings, invalidateSettingsCache } from "@/lib/settings";
import { updateSettingsSchema } from "@/schemas";
import { resolveRewardItemLine } from "@/lib/reward-item-line";
import { normalizeMilestones, LOYALTY_RULES_SCHEMA_VERSION } from "@pos/shared/loyalty-rules";
import { redemptionSnapshotOf } from "@pos/shared/reward-redemption";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}reward`;

// A complete loyaltyRules container. The schema requires EVERY key once
// `loyaltyRules` is present at all (Mongoose $set-replaces a nested path
// WHOLE), so a partial fixture would fail for the wrong reason.
//
// CB-5D (owner, 2026-09-15): `levels` and `membership` are REMOVED from
// loyaltyRulesSchema — no client used either — and LOYALTY_RULES_SCHEMA_VERSION
// bumped to 2, so `v` must track the constant rather than a hardcoded literal
// (a stale `v: 1` here would now fail updateSettingsSchema's own version gate).
function rulesWith(milestones: unknown[]): Record<string, unknown> {
  return {
    v: LOYALTY_RULES_SCHEMA_VERSION,
    unitLabel: "stamp",
    milestones,
  };
}

let passed = 0;
let failed = 0;

async function scenario(n: number, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${n} — ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${n} — ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

// The route's EXACT shape — same validator, same option set. A shortcut call
// (Settings.updateOne, or writing the doc directly) would prove nothing: it is
// precisely the strict-schema cast on THIS path that dropped the fields.
async function routeShapedUpdate(candidate: unknown): Promise<void> {
  const parsed = updateSettingsSchema.safeParse(candidate);
  assert.ok(
    parsed.success,
    `fixture must parse: ${!parsed.success ? JSON.stringify(parsed.error.flatten()) : ""}`,
  );
  await Settings.findOneAndUpdate({}, parsed.data, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean();
  invalidateSettingsCache();
}

async function storedMilestones(): Promise<Record<string, unknown>[]> {
  const doc = (await Settings.findOne().lean()) as ISettings | null;
  const rules = doc?.loyaltyRules as { milestones?: Record<string, unknown>[] } | undefined;
  return rules?.milestones ?? [];
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = uri.split("/").pop()?.split("?")[0] ?? "";
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    console.error(`Refusing to run: database "${dbName}" is not a ${SCRATCH_PREFIX}* scratch DB.`);
    process.exit(1);
  }

  // readSettings() (scenario 2) calls connectDB(), which reads
  // process.env.MONGODB_URI directly — the local `uri` default above never
  // reaches it otherwise, mirroring verify-loyalty-rules-live.ts's own fix.
  process.env.MONGODB_URI = uri;
  await mongoose.connect(uri);
  console.log(`\nloyalty reward item live — live against ${dbName}\n`);

  const product = await Product.create({
    name: "Masala Chai",
    categoryId: new mongoose.Types.ObjectId(),
    price: 200,
    discount: 25, // sells at 150 — proves the discount is honoured
    available: true,
    image: "",
    modifiers: [],
    isActive: true,
  });
  const productId = product._id.toString();

  try {
    await scenario(
      1,
      "route-shaped save STORES itemProductId and qty (the bug that shipped silently)",
      async () => {
        await Settings.deleteMany({});
        invalidateSettingsCache();
        await routeShapedUpdate({
          loyaltyRules: rulesWith([
            { at: 8, kind: "item", value: 0, item: "Masala Chai", itemProductId: productId, qty: 2 },
          ]),
        });
        const rows = await storedMilestones();
        assert.equal(rows.length, 1, "the rung must be stored");
        assert.equal(rows[0]!.itemProductId, productId, "the product REFERENCE must survive the write");
        assert.equal(rows[0]!.qty, 2, "the dish COUNT must survive the write");
      },
    );

    await scenario(
      2,
      "the stored rung round-trips through readSettings -> normalize -> snapshot",
      async () => {
        const settings = await readSettings();
        const rules = settings?.loyaltyRules as { milestones?: [] } | undefined;
        const [resolved] = normalizeMilestones(rules?.milestones ?? []);
        assert.ok(resolved, "the ladder must resolve");
        assert.equal(resolved.itemProductId, productId);
        assert.equal(resolved.qty, 2);
        const snapshot = redemptionSnapshotOf(resolved);
        assert.equal(snapshot.itemProductId, productId, "the claim snapshot carries the reference");
        assert.equal(snapshot.qty, 2, "the claim snapshot carries the count");
      },
    );

    await scenario(
      3,
      "the resolved dish is priced with the product DISCOUNT applied, not the base price",
      async () => {
        const result = await resolveRewardItemLine({
          at: 8,
          kind: "item",
          value: 0,
          item: "Masala Chai",
          itemProductId: productId,
          qty: 2,
        });
        assert.ok(result.ok, `expected a line, got ${!result.ok ? result.reason : ""}`);
        assert.equal(result.line.price, 150, "200 at 25% off must bill 150, never 200");
        assert.equal(result.line.qty, 2, "the claim's stored count is what is granted");
        assert.equal(result.line.reward, true, "the line must carry the flag the subtotal skips on");
        assert.equal(result.line.name, "Masala Chai");
      },
    );

    await scenario(
      4,
      "a deleted (archived) product makes the claim fail loudly, never silently",
      async () => {
        await Product.updateOne({ _id: product._id }, { $set: { isActive: false } });
        const result = await resolveRewardItemLine({
          at: 8,
          kind: "item",
          value: 0,
          item: "Masala Chai",
          itemProductId: productId,
        });
        assert.ok(!result.ok, "an archived dish must not produce a line");
        assert.equal(result.reason, "product-missing");
        await Product.updateOne({ _id: product._id }, { $set: { isActive: true } });
      },
    );

    await scenario(
      5,
      "a pre-D8 rung (name only, no reference) is NOT resolvable and never falls back to the name",
      async () => {
        const result = await resolveRewardItemLine({
          at: 8,
          kind: "item",
          value: 0,
          item: "Masala Chai",
        });
        assert.ok(!result.ok, "a name alone must not resolve");
        assert.equal(result.reason, "no-product-ref");
      },
    );

    await scenario(
      6,
      "a NON-item rung carrying a stale reference is REJECTED by the route's validator",
      async () => {
        const parsed = updateSettingsSchema.safeParse({
          loyaltyRules: rulesWith([
            { at: 8, kind: "flat", value: 50, item: "", itemProductId: productId },
          ]),
        });
        assert.equal(parsed.success, false, "a flat rung may not carry a dish");
      },
    );
  } finally {
    await Product.deleteMany({});
    await Settings.deleteMany({});
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "live leg failed");
  process.exit(1);
});
