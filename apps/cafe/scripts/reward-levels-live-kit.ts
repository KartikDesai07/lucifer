/**
 * Shared fixtures + helpers of the CB-7 S1 live leg (verify-reward-levels-live.ts): the sample blob, the settings
 * route's PUT call shape, and the Customer-model helpers. Split out only to keep both files under the size cap.
 * (ops CLI support module, not app code.)
 */
import assert from "node:assert/strict";
import { type FilterQuery, type Types, type UpdateQuery } from "mongoose";

import { Settings } from "@/models/Settings";
import { Customer, type ICustomer } from "@/models/Customer";
import { invalidateSettingsCache, settingsUpdateOf } from "@/lib/settings";
import { cryptoRng, newRewardCardId } from "@/lib/reward-rng";
import { updateSettingsSchema } from "@/schemas";
import type { RewardCardSnapshot, RewardOptionKind } from "@pos/shared/reward-levels";
import { buildCardSnapshot } from "@pos/shared/reward-levels-engine";

export const REF_A = "a".repeat(24);
export const REF_B = "b".repeat(24);
const SLOT = { scratchDays: 7, useDays: 14, options: [{ id: "p1", kind: "bill-percent" as const, weight: 1, min: 5, max: 10 }] };

export type Rec = Record<string, unknown>;
export type Flt = FilterQuery<ICustomer>;
export type Upd = UpdateQuery<ICustomer>;
let mobileSeq = 0;
let cardSeq = 0;
// One real option of every kind, in two boxes (a box holds at most 5). enabled:false - the launch lock refuses true.
export const BLOB = {
  v: 1,
  enabled: false,
  minBill: 100,
  levels: [
    {
      size: 5,
      slots: [
        {
          step: 3, scratchDays: 7, useDays: 14,
          options: [
            { kind: "bill-percent", id: "a1", weight: 1, min: 5, max: 10, minBill: 200 },
            { kind: "bill-flat", id: "a2", weight: 2, min: 20, max: 50 },
            { kind: "product-percent", id: "a3", weight: 1, min: 10, max: 20, productId: REF_A, productName: "Cold coffee", capRupees: 80 },
            { kind: "category-percent", id: "a4", weight: 1, min: 5, max: 15, categoryId: REF_B, categoryName: "Beverages" },
            { kind: "category-flat", id: "a5", weight: 1, min: 10, max: 30, categoryId: REF_B, categoryName: "Beverages" },
          ],
        },
        {
          step: 5, scratchDays: 10, useDays: 30,
          options: [
            { kind: "free-item", id: "b1", weight: 1, productId: REF_A, productName: "Cold coffee", qty: 1 },
            { kind: "points", id: "b2", weight: 3, min: 10, max: 50 },
            { kind: "none", id: "b3", weight: 1, label: "Better luck next time" },
          ],
        },
      ],
    },
  ],
};

export async function reset(): Promise<void> {
  await Settings.collection.deleteMany({});
  invalidateSettingsCache();
}
// PUT /api/settings, minus auth and HTTP: the same validator, the same update document builder, the same options.
export async function put(body: unknown): Promise<{ ok: true; data: Rec } | { ok: false; paths: string[] }> {
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) return { ok: false, paths: parsed.error.issues.map((i) => i.path.join(".")) };
  await Settings.findOneAndUpdate({}, settingsUpdateOf(parsed.data), { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }).lean();
  invalidateSettingsCache();
  return { ok: true, data: parsed.data as Rec };
}
export async function mustPut(body: unknown): Promise<Rec> {
  const r = await put(body);
  assert.ok(r.ok, `the body must pass the write gate: ${r.ok ? "" : r.paths.join(", ")}`);
  return r.ok ? r.data : {};
}
export async function raw(): Promise<Rec> {
  const doc = (await Settings.collection.findOne({})) as Rec | null;
  assert.ok(doc, "a Settings document exists");
  return doc;
}

// A card from the real engine; `over` sets the lifecycle fields a test needs (status, keepUntil, pointsSpent...).
export function card(over: Partial<RewardCardSnapshot> = {}, now: Date = new Date(), kind: RewardOptionKind = "bill-percent"): RewardCardSnapshot {
  const option = kind === "points" ? { id: "pt1", kind: "points" as const, weight: 1, min: 10, max: 20 } : SLOT.options[0];
  const built = buildCardSnapshot({ id: newRewardCardId(), issueKey: `step:${++cardSeq}`, source: "level", level: 1, step: 3, slot: { ...SLOT, options: [option] }, rng: cryptoRng, now });
  return { ...built, ...over };
}
export async function newCustomer(cards?: RewardCardSnapshot[], extra: Rec = {}): Promise<Types.ObjectId> {
  mobileSeq += 1;
  const doc = await new Customer({ name: "Scratch Diner", mobile: String(9_000_000_000 + mobileSeq), ...(cards ? { rewardCards: cards } : {}), ...extra }).save();
  return doc._id as Types.ObjectId;
}
export const cardsOf = async (id: Types.ObjectId): Promise<RewardCardSnapshot[]> => {
  const doc = await Customer.findById(id).select("+rewardCards").lean();
  return (doc?.rewardCards ?? []) as RewardCardSnapshot[];
};
export const rawOf = async (id: Types.ObjectId): Promise<Rec> => ((await Customer.collection.findOne({ _id: id })) as Rec | null) ?? {};
export const upd = (filter: Flt, update: Upd, options: Rec = {}) => Customer.updateOne(filter, update, options);
