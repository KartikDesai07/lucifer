import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { RewardCampaign } from "@/models/RewardCampaign";
import { created, failure, requireAdmin, serverError, success } from "@/lib/api-helpers";
import { campaignDtoOf, type StoredCampaign } from "@/lib/reward-campaign-dto";
import {
  CAMPAIGNS_ACTIVE_MAX,
  CAMPAIGNS_LIST_MAX,
  CAMPAIGN_CUSTOMERS_GONE,
  CAMPAIGN_DAY_PASSED,
  CAMPAIGN_LIMIT_REACHED,
  campaignWindow,
  type RewardCampaignData,
  type RewardCampaignsData,
} from "@pos/shared/reward-campaigns";
import { rewardCampaignWriteSchema } from "@pos/shared/schemas/reward-campaign.schema";
import { cafeDateString } from "@pos/shared/utils";

export const dynamic = "force-dynamic";

const HTTP_BAD_REQUEST = 400;
const HTTP_CONFLICT = 409;

// The picked diners' names for a page of campaigns: ONE read for the union of their ids, the NAME only (never a mobile).
async function namesOf(rows: readonly StoredCampaign[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const row of rows) for (const id of row.customerIds ?? []) ids.add(id.toString());
  if (ids.size === 0) return new Map();
  const found = await Customer.find({ _id: { $in: [...ids] } }).select("name").lean();
  return new Map(found.map((c) => [c._id.toString(), c.name]));
}

// GET /api/reward-campaigns - admin only. Latest-ending first, each with its picked diners' names. endsAt descending puts every
// campaign not yet ended (endsAt >= now) ahead of every ended one, so the ones the POST cap counts are always on the page.
export async function GET() {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  try {
    await connectDB();
    const rows: StoredCampaign[] = await RewardCampaign.find().sort({ endsAt: -1 }).limit(CAMPAIGNS_LIST_MAX).lean();
    const names = await namesOf(rows);
    const campaigns: RewardCampaignsData["campaigns"] = [];
    for (const row of rows) {
      // A row whose stored box this build cannot read is SKIPPED (an empty box would mislead the owner); it never gives a card either.
      const dto = campaignDtoOf(row, names);
      if (dto) campaigns.push(dto);
    }
    return success({ campaigns } satisfies RewardCampaignsData);
  } catch (error) {
    return serverError("Failed to load the festival campaigns", error);
  }
}

// POST /api/reward-campaigns - admin only. Creates one campaign: validated, not already over, under the active cap, and
// every picked diner must still exist.
export async function POST(req: Request) {
  const admin = await requireAdmin();
  if ("error" in admin) return admin.error;

  const body: unknown = await req.json().catch(() => null);
  const parsed = rewardCampaignWriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message ?? "Invalid festival campaign", details: parsed.error.flatten().fieldErrors },
      { status: HTTP_BAD_REQUEST },
    );
  }
  const input = parsed.data;
  const now = new Date();
  if (input.endDay < cafeDateString(now)) return failure(CAMPAIGN_DAY_PASSED, HTTP_BAD_REQUEST);

  try {
    await connectDB();
    // "Not yet ended" = planned or running. Two racing creates can still make a fourth; the issue step reads at most the cap.
    if ((await RewardCampaign.countDocuments({ endsAt: { $gte: now } })) >= CAMPAIGNS_ACTIVE_MAX) {
      return failure(CAMPAIGN_LIMIT_REACHED, HTTP_CONFLICT);
    }
    if (input.audience === "picked") {
      const existing = await Customer.countDocuments({ _id: { $in: input.customerIds } });
      if (existing !== input.customerIds.length) return failure(CAMPAIGN_CUSTOMERS_GONE, HTTP_BAD_REQUEST);
    }

    const doc = await RewardCampaign.create({
      name: input.name,
      audience: input.audience,
      ...(input.audience === "picked" ? { customerIds: input.customerIds } : {}),
      ...(input.maxCards !== undefined ? { maxCards: input.maxCards } : {}),
      issued: 0,
      ...campaignWindow(input.startDay, input.endDay),
      box: input.box,
    });
    const names = input.audience === "picked" ? await namesOf([doc]) : new Map<string, string>();
    const campaign = campaignDtoOf(doc, names);
    if (!campaign) return serverError("Failed to read back the festival campaign", new Error("unreadable box"));
    return created({ campaign } satisfies RewardCampaignData);
  } catch (error) {
    return serverError("Failed to create the festival campaign", error);
  }
}
