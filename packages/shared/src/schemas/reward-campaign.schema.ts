import { z } from "zod";
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_CUSTOMERS_MAX,
  CAMPAIGN_DAYS_MAX,
  CAMPAIGN_MAX_CARDS_MAX,
  CAMPAIGN_MAX_CARDS_MIN,
  campaignDays,
  type CampaignBox,
} from "../reward-campaigns";
import { REWARD_DAYS_MAX, REWARD_DAYS_MIN, REWARD_OPTIONS_PER_SLOT_MAX, REWARD_TITLE_MAX_LEN } from "../reward-levels";
import { expenseDateSchema } from "./expense.schema";
import { objectIdString } from "./object-id.schema";
import { REWARD_LEVELS_READ_LIMITS, rewardOptionReadSchema } from "./reward-levels-read.schema";
import { addBoxOptionIssues, rewardOptionWriteSchema } from "./reward-levels.schema";

// CB-7 S6 session 3 (plan §2.8) — the WRITE gate of a festival-card campaign (POST /api/reward-campaigns) and the
// READ twin of its stored box. The box uses the SAME option grammar and the SAME cross-option rules as a level's box
// (rewardOptionWriteSchema + addBoxOptionIssues), so the two can never drift. Whether the last day has already passed
// needs "today", so the ROUTE checks that — this schema only checks the shape. `.strict()` everywhere (an unknown key
// is a typo or a stale client).

function int(min: number, max: number, what: string): z.ZodNumber {
  return z
    .number({ invalid_type_error: `${what} must be a whole number` })
    .int("Use a whole number")
    .min(min, `${what} must be at least ${min}`)
    .max(max, `${what} can be at most ${max}`);
}

export const campaignBoxWriteSchema = z
  .object({
    scratchDays: int(REWARD_DAYS_MIN, REWARD_DAYS_MAX, "The days to scratch"),
    useDays: int(REWARD_DAYS_MIN, REWARD_DAYS_MAX, "The days to use"),
    options: z
      .array(rewardOptionWriteSchema)
      .min(1, "Add at least one reward to this box")
      .max(REWARD_OPTIONS_PER_SLOT_MAX, `A box can hold at most ${REWARD_OPTIONS_PER_SLOT_MAX} rewards`),
  })
  .strict();

export const rewardCampaignWriteSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the campaign a name")
      .max(REWARD_TITLE_MAX_LEN, `The name can be at most ${REWARD_TITLE_MAX_LEN} characters`),
    audience: z.enum(CAMPAIGN_AUDIENCES),
    customerIds: z
      .array(objectIdString)
      .max(CAMPAIGN_CUSTOMERS_MAX, `You can pick at most ${CAMPAIGN_CUSTOMERS_MAX} customers`)
      .default([]),
    maxCards: int(CAMPAIGN_MAX_CARDS_MIN, CAMPAIGN_MAX_CARDS_MAX, "The number of cards").optional(),
    startDay: expenseDateSchema,
    endDay: expenseDateSchema,
    box: campaignBoxWriteSchema,
  })
  .strict()
  .superRefine((c, ctx) => {
    addBoxOptionIssues(c.box.options, ctx, ["box"]);
    // String compare is valid for fixed-width YYYY-MM-DD values.
    if (c.endDay < c.startDay) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDay"], message: "The last day can't be before the first day" });
    } else if (campaignDays(c.startDay, c.endDay) > CAMPAIGN_DAYS_MAX) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDay"], message: `A campaign can run for at most ${CAMPAIGN_DAYS_MAX} days` });
    }
    if (c.audience === "picked" && c.customerIds.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerIds"], message: "Pick at least one customer" });
    }
    if (c.audience === "everyone" && c.customerIds.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerIds"], message: "Every customer gets a card, so leave the list empty" });
    }
    if (new Set(c.customerIds).size !== c.customerIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["customerIds"], message: "A customer is picked twice" });
    }
  });

export type RewardCampaignWriteInput = z.infer<typeof rewardCampaignWriteSchema>;
// What a client sends (customerIds may be left out for "everyone").
export type RewardCampaignWriteBody = z.input<typeof rewardCampaignWriteSchema>;

// PATCH /api/reward-campaigns/[id] — "End now" is the only change (a campaign is never edited: issued cards keep
// their prize, plan "Risks").
export const rewardCampaignEndSchema = z.object({ end: z.literal(true) }).strict();

// ── READ twin of the stored box (never narrows: an unreadable box only skips that campaign at issue time) ─────────
const L = REWARD_LEVELS_READ_LIMITS;
export const campaignBoxReadSchema = z.object({
  scratchDays: z.number().int().min(1).max(L.days),
  useDays: z.number().int().min(1).max(L.days),
  options: z.array(rewardOptionReadSchema).min(1).max(L.optionsPerSlot),
});

/** The stored box, or null when this build cannot read it (the issue step then skips the campaign). */
export function parseStoredCampaignBox(raw: unknown): CampaignBox | null {
  const parsed = campaignBoxReadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
