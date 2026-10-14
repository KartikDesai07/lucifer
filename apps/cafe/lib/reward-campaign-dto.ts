import type { CampaignAudience, CampaignCustomerRef, RewardCampaignDto } from "@pos/shared/reward-campaigns";
import { parseStoredCampaignBox } from "@pos/shared/schemas/reward-campaign.schema";

// CB-7 S6 session 3 - the ONE stored-campaign -> wire DTO mapper, shared by GET / POST /api/reward-campaigns and the
// PATCH (end now), so the three can never drift. Pure: it takes lean rows and a name lookup, so the routes own the IO.
// A picked diner is a NAME only - never a mobile number.

export interface StoredCampaign {
  _id: { toString(): string };
  name: string;
  audience: CampaignAudience;
  customerIds?: readonly { toString(): string }[];
  maxCards?: number;
  issued?: number;
  startsAt: Date;
  endsAt: Date;
  endedAt?: Date;
  box: unknown;
  createdAt: Date;
}

// The picked diners' names, in the order the campaign picked them. A deleted diner (no name on file) is left out.
function customersOf(row: StoredCampaign, names: ReadonlyMap<string, string>): CampaignCustomerRef[] {
  const refs: CampaignCustomerRef[] = [];
  for (const raw of row.customerIds ?? []) {
    const id = raw.toString();
    const name = names.get(id);
    if (name !== undefined) refs.push({ id, name });
  }
  return refs;
}

/** The row as the owner sees it, or null when its stored box is unreadable (the list skips such a row). */
export function campaignDtoOf(row: StoredCampaign, names: ReadonlyMap<string, string>): RewardCampaignDto | null {
  const box = parseStoredCampaignBox(row.box);
  if (box === null) return null;
  return {
    id: row._id.toString(),
    name: row.name,
    audience: row.audience,
    customers: customersOf(row, names),
    maxCards: row.maxCards ?? null,
    issued: row.issued ?? 0,
    startsAt: row.startsAt.getTime(),
    endsAt: row.endsAt.getTime(),
    endedEarly: !!row.endedAt,
    createdAt: row.createdAt.getTime(),
    box,
  };
}
