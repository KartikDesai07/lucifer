import { Schema } from "mongoose";

import {
  REWARD_CARD_SOURCES,
  REWARD_CARD_STATUSES,
  REWARD_OPTION_KINDS,
  type RewardCardSnapshot,
  type RewardPoolEntry,
} from "@pos/shared/reward-levels";

// CB-7 S1 — one issued scratch card, embedded in Customer.rewardCards (plan §2.2). Every path of
// RewardCardSnapshot is DECLARED here: Mongoose strict mode silently drops an undeclared key, so a field added
// to the shared type but not to this schema would vanish on save (customer-reward-card.test.ts pins the pair).
//
// `_id: false` (a card is addressed by its own 12-hex `id`, via $elemMatch), no `default:` anywhere (omit-empty),
// and NO `expires` on any Date: the platform allows exactly one registry TTL index (ttl-guard), and a card's
// deadlines are DERIVED states (cardStateAt), never deletions — eviction is the bounded $slice at issue.

// The box's odds snapshotted for the card's terms (F14): kind + a config-derived label + the weight.
const rewardPoolEntrySchema = new Schema<RewardPoolEntry>(
  {
    kind: { type: String, enum: [...REWARD_OPTION_KINDS], required: true },
    label: { type: String, required: true },
    weight: { type: Number, required: true },
  },
  { _id: false },
);

export const rewardCardSchema = new Schema<RewardCardSnapshot>(
  {
    id: { type: String, required: true },
    issueKey: { type: String, required: true }, // "step:<n>" or "camp:<campaignId>"
    source: { type: String, enum: [...REWARD_CARD_SOURCES], required: true },
    level: { type: Number },
    step: { type: Number },
    campaignId: { type: String },
    title: { type: String },
    // The outcome — rolled once at issue.
    optionId: { type: String, required: true },
    kind: { type: String, enum: [...REWARD_OPTION_KINDS], required: true },
    value: { type: Number, required: true },
    productId: { type: String },
    productName: { type: String },
    categoryId: { type: String },
    categoryName: { type: String },
    qty: { type: Number },
    capRupees: { type: Number },
    minBill: { type: Number },
    label: { type: String },
    pool: { type: [rewardPoolEntrySchema], required: true },
    issuedAt: { type: Date, required: true },
    scratchBy: { type: Date, required: true },
    useDays: { type: Number, required: true },
    keepUntil: { type: Date, required: true },
    status: { type: String, enum: [...REWARD_CARD_STATUSES], required: true },
    revealedAt: { type: Date },
    validUntil: { type: Date },
    usedAt: { type: Date },
    orderId: { type: String },
    pointsSpent: { type: Number }, // points lots only (§2.7)
  },
  { _id: false },
);
