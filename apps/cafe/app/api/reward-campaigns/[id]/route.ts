import { NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { RewardCampaign } from "@/models/RewardCampaign";
import { failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { campaignDtoOf } from "@/lib/reward-campaign-dto";
import { CAMPAIGN_ALREADY_ENDED, CAMPAIGN_NOT_FOUND, type RewardCampaignData } from "@pos/shared/reward-campaigns";
import { rewardCampaignEndSchema } from "@pos/shared/schemas/reward-campaign.schema";

export const dynamic = "force-dynamic";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;

// PATCH /api/reward-campaigns/[id] - admin only. "End now" is the only change: the window closes at this instant (cards
// already issued keep their prize). The guard is the window itself, so two clicks end it once and the second is a 409.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const { id } = await ctx.params;
  if (!mongoose.isValidObjectId(id)) return failure(CAMPAIGN_NOT_FOUND, HTTP_NOT_FOUND);

  const body: unknown = await req.json().catch(() => null);
  const parsed = rewardCampaignEndSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid request", details: parsed.error.flatten().fieldErrors },
      { status: HTTP_BAD_REQUEST },
    );
  }

  try {
    await connectDB();
    const now = new Date();
    const doc = await RewardCampaign.findOneAndUpdate(
      { _id: id, endsAt: { $gte: now } },
      { $set: { endsAt: now, endedAt: now } },
      { new: true },
    ).lean();
    if (!doc) {
      // No live row: it either ended already (409) or never existed (404).
      const exists = await RewardCampaign.exists({ _id: id });
      return exists ? failure(CAMPAIGN_ALREADY_ENDED, HTTP_CONFLICT) : failure(CAMPAIGN_NOT_FOUND, HTTP_NOT_FOUND);
    }
    const found = await Customer.find({ _id: { $in: doc.customerIds ?? [] } }).select("name").lean();
    const names = new Map(found.map((c) => [c._id.toString(), c.name]));
    const campaign = campaignDtoOf(doc, names);
    if (!campaign) return serverError("Failed to read back the festival campaign", new Error("unreadable box"));
    return success({ campaign } satisfies RewardCampaignData);
  } catch (error) {
    return serverError("Failed to end the festival campaign", error);
  }
}
