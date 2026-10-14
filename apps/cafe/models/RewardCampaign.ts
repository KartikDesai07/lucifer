import mongoose, { Schema, Types, type Document, type Model } from "mongoose";
import { CAMPAIGN_AUDIENCES, type CampaignAudience } from "@pos/shared/reward-campaigns";

// CB-7 S6 session 3 (plan section 2.8) - a festival-card campaign: the owner gives ONE scratch card to picked (or every)
// diner with an account, lazily, the first time their wallet loads inside [startsAt, endsAt]. Plain default-bound CORE
// model, v1-grade (mirrors models/PromoRedemption.ts): a few rows, never on the ledger's sharding discipline.
//
// `issued` is the budget counter: reserved with a guarded $inc BEFORE a card is pushed and given back ($inc -1) only when
// the push provably matched nothing. `box` is stored Mixed exactly as the write gate validated it and READ-parsed at issue
// time (parseStoredCampaignBox) - an unreadable box skips the campaign, it never throws. NO TTL: ttl-guard allows exactly
// one registry TTL (Heartbeat), and an ended campaign is history the owner's list still shows.
export interface IRewardCampaign extends Document {
  name: string;
  audience: CampaignAudience;
  customerIds?: Types.ObjectId[]; // "picked" only
  maxCards?: number; // absent = no budget
  issued: number;
  startsAt: Date; // the first day's 00:00 IST
  endsAt: Date; // the last day's 23:59:59.999 IST, or the "End now" instant
  endedAt?: Date; // set by "End now"
  box: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export const rewardCampaignSchema = new Schema<IRewardCampaign>(
  {
    name: { type: String, required: true, trim: true },
    audience: { type: String, enum: CAMPAIGN_AUDIENCES, required: true },
    // `default: undefined`: an "everyone" campaign stores no array at all (omit-empty).
    customerIds: { type: [Schema.Types.ObjectId], default: undefined },
    maxCards: { type: Number },
    issued: { type: Number, default: 0 },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    endedAt: { type: Date },
    box: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

// The owner's active-count and the issue step's window filter both lead with the end of the window.
rewardCampaignSchema.index({ endsAt: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const RewardCampaign: Model<IRewardCampaign> =
  (mongoose.models.RewardCampaign as Model<IRewardCampaign>) ??
  mongoose.model<IRewardCampaign>("RewardCampaign", rewardCampaignSchema);
