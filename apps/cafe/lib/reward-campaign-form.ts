// CB-7 S6 session 3 (E2) — the form side of a festival-card campaign: the draft the sheet edits, the starter draft, the
// draft <-> write-body mapping, and the write gate's problems turned into plain sentences. The campaign's ONE box is
// edited by the same RewardOptionFields / RewardTtlFields the settings editor uses, so its issues are mapped onto a
// fixed sentinel level and step (CAMPAIGN_BOX_LEVEL / CAMPAIGN_BOX_STEP) that those fields look problems up by.
// PURE, client-safe: no Mongoose, no node:crypto, never lib/reward-levels-config.

import type { ZodIssue } from "zod";
import type { CampaignAudience, CampaignBox } from "@pos/shared/reward-campaigns";
import type { RewardSlot } from "@pos/shared/reward-levels";
import {
  rewardCampaignWriteSchema,
  type RewardCampaignWriteBody,
} from "@pos/shared/schemas/reward-campaign.schema";
import { PROBLEM_FALLBACK_FIELD, PROBLEM_FALLBACK_GENERIC } from "@/lib/reward-levels-copy";
import { newSlot } from "@/lib/reward-levels-edit";
import { isPlain, type RewardProblem } from "@/lib/reward-levels-form";

// The box fields look a problem up by (level, step). A campaign has neither, so its one box sits at these fixed values.
export const CAMPAIGN_BOX_LEVEL = 0;
export const CAMPAIGN_BOX_STEP = 1;

export interface CampaignDraft {
  name: string;
  audience: CampaignAudience;
  /** Picked customers' ids; always [] on the wire for "everyone". */
  customerIds: string[];
  /** Blank = no limit. NaN while the owner types something that is not a number. */
  maxCards: number | undefined;
  /** "YYYY-MM-DD", "" until picked. */
  startDay: string;
  endDay: string;
  box: CampaignBox;
}

// A fresh draft: every customer with an account, today only, one box with one "10% off the bill" reward — the same
// starting values as a new settings box (7 days to scratch, 30 days to use).
export function starterCampaignDraft(today: string): CampaignDraft {
  const { scratchDays, useDays, options } = newSlot(CAMPAIGN_BOX_STEP);
  return { name: "", audience: "everyone", customerIds: [], maxCards: undefined, startDay: today, endDay: today, box: { scratchDays, useDays, options } };
}

// The box as a slot, so the settings editor's pure edit ops (replaceOption, withOption, withoutOption) apply to it.
export function editBox(draft: CampaignDraft, edit: (slot: RewardSlot) => RewardSlot): CampaignDraft {
  const { scratchDays, useDays, options } = edit({ step: CAMPAIGN_BOX_STEP, ...draft.box });
  return { ...draft, box: { scratchDays, useDays, options } };
}

// What the form sends. maxCards is left out when blank; the picked list is dropped for "everyone".
export function campaignWriteBody(draft: CampaignDraft): RewardCampaignWriteBody {
  return {
    name: draft.name,
    audience: draft.audience,
    customerIds: draft.audience === "picked" ? draft.customerIds : [],
    ...(draft.maxCards !== undefined ? { maxCards: draft.maxCards } : {}),
    startDay: draft.startDay,
    endDay: draft.endDay,
    box: draft.box,
  };
}

// The body read back as a draft (customerIds may be absent for "everyone").
export function campaignDraftOf(body: RewardCampaignWriteBody): CampaignDraft {
  return {
    name: body.name,
    audience: body.audience,
    customerIds: body.customerIds ?? [],
    maxCards: body.maxCards,
    startDay: body.startDay,
    endDay: body.endDay,
    box: body.box,
  };
}

// ── The write gate, in plain words ───────────────────────────────────────────

export type CampaignField = "name" | "audience" | "customerIds" | "maxCards" | "startDay" | "endDay";
const CAMPAIGN_FIELDS: ReadonlySet<string> = new Set<CampaignField>(["name", "audience", "customerIds", "maxCards", "startDay", "endDay"]);

export interface CampaignProblems {
  /** The first sentence for each campaign-level field. */
  fields: Partial<Record<CampaignField, string>>;
  /** The box's problems, in the (level, step, option, field) shape RewardOptionFields reads. */
  box: RewardProblem[];
  /** Every problem as one sentence, in schema order (the first one is what the submit button's hint shows). */
  sentences: string[];
}

export const NO_CAMPAIGN_PROBLEMS: CampaignProblems = { fields: {}, box: [], sentences: [] };
const BOX_ROOT = "box";
const OPTIONS_BRANCH = "options";
// A field the form has no home for (an unknown key cannot come from this form) still says something.
const CAMPAIGN_FALLBACK = "Check this campaign. Something in it is not filled in correctly.";

function messageOf(issue: ZodIssue, field: string | null): string {
  if (isPlain(issue)) return issue.message;
  return (field !== null && PROBLEM_FALLBACK_FIELD[field]) || PROBLEM_FALLBACK_GENERIC;
}

// Box paths: box.<scratchDays|useDays>, box.options (the box-wide rules) or box.options.<oi>.<field>.
function boxProblem(issue: ZodIssue, draft: CampaignDraft): RewardProblem {
  const [, branch, oi, field] = issue.path;
  const option = typeof oi === "number" ? draft.box.options[oi] : undefined;
  const name = branch === OPTIONS_BRANCH && typeof oi === "number" ? field : branch;
  const fieldName = typeof name === "string" ? name : null;
  return {
    level: CAMPAIGN_BOX_LEVEL,
    step: CAMPAIGN_BOX_STEP,
    optionId: option?.id ?? null,
    field: fieldName ?? (branch === OPTIONS_BRANCH ? OPTIONS_BRANCH : null),
    message: messageOf(issue, fieldName),
  };
}

export function campaignProblems(draft: CampaignDraft): CampaignProblems {
  const parsed = rewardCampaignWriteSchema.safeParse(campaignWriteBody(draft));
  if (parsed.success) return NO_CAMPAIGN_PROBLEMS;
  const fields: Partial<Record<CampaignField, string>> = {};
  const box: RewardProblem[] = [];
  const sentences: string[] = [];
  const seen = new Set<string>();
  for (const issue of parsed.error.issues) {
    const root = issue.path[0];
    if (root === BOX_ROOT) {
      const problem = boxProblem(issue, draft);
      const key = `${problem.optionId}|${problem.field}|${problem.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      box.push(problem);
      sentences.push(problem.message);
    } else {
      const field = typeof root === "string" && CAMPAIGN_FIELDS.has(root) ? (root as CampaignField) : null;
      const message = field === null ? CAMPAIGN_FALLBACK : messageOf(issue, field);
      if (field !== null && fields[field] === undefined) fields[field] = message;
      if (!sentences.includes(message)) sentences.push(message);
    }
  }
  return { fields, box, sentences };
}

export type CampaignSubmit = { ok: true; body: RewardCampaignWriteBody } | { ok: false; problems: CampaignProblems };

// The gate before POST: a valid draft goes out as the schema's own output (trimmed name), an invalid one never leaves
// the browser (the route's own 400 is the second wall).
export function campaignSubmit(draft: CampaignDraft): CampaignSubmit {
  const parsed = rewardCampaignWriteSchema.safeParse(campaignWriteBody(draft));
  if (parsed.success) return { ok: true, body: parsed.data };
  return { ok: false, problems: campaignProblems(draft) };
}
