import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStoredCampaignBox, rewardCampaignEndSchema, rewardCampaignWriteSchema } from "./reward-campaign.schema";
import {
  CAMPAIGN_CUSTOMERS_MAX,
  CAMPAIGN_DAYS_MAX,
  CAMPAIGN_MAX_CARDS_MAX,
  campaignDays,
  campaignStatusAt,
  campaignWindow,
  campaignIssueKey,
} from "../reward-campaigns";
import { REWARD_OPTIONS_PER_SLOT_MAX, REWARD_TITLE_MAX_LEN } from "../reward-levels";

// CB-7 S6 session 3 - the festival-card WRITE gate (every rule, strict), the window / status helpers (inclusive ends, IST
// midnight) and the READ twin of the stored box (never narrows, null on junk).

const ID_A = "64b7f0c2a1b2c3d4e5f60a01";
const ID_B = "64b7f0c2a1b2c3d4e5f60a02";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function valid(): Record<string, unknown> {
  return {
    name: "  Diwali treat ",
    audience: "picked",
    customerIds: [ID_A, ID_B],
    maxCards: 50,
    startDay: "2026-11-08",
    endDay: "2026-11-10",
    box: {
      scratchDays: 5,
      useDays: 14,
      options: [
        { id: "a1", kind: "bill-percent", weight: 2, min: 5, max: 15 },
        { id: "a2", kind: "none", weight: 1 },
      ],
    },
  };
}

function issuesOf(body: unknown): { path: string; message: string }[] {
  const res = rewardCampaignWriteSchema.safeParse(body);
  assert.equal(res.success, false, "expected a refusal");
  return res.success ? [] : res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}
const refusedAt = (body: unknown, path: string): boolean => issuesOf(body).some((i) => i.path === path);
const mutated = (fn: (c: Record<string, unknown>) => void): Record<string, unknown> => {
  const c = valid();
  fn(c);
  return c;
};

test("write: a valid body is accepted and the name is trimmed", () => {
  const res = rewardCampaignWriteSchema.safeParse(valid());
  assert.equal(res.success, true);
  if (res.success) {
    assert.equal(res.data.name, "Diwali treat");
    assert.deepEqual(res.data.customerIds, [ID_A, ID_B]);
  }
});

test("write: 'everyone' with no ids and no maxCards is accepted; customerIds defaults to []", () => {
  const body = mutated((c) => {
    c.audience = "everyone";
    delete c.customerIds;
    delete c.maxCards;
  });
  const res = rewardCampaignWriteSchema.safeParse(body);
  assert.equal(res.success, true);
  if (res.success) {
    assert.deepEqual(res.data.customerIds, []);
    assert.equal(res.data.maxCards, undefined);
  }
});

test("write: endDay before startDay is refused; a one-day campaign is fine", () => {
  assert.equal(refusedAt(mutated((c) => (c.endDay = "2026-11-07")), "endDay"), true);
  assert.equal(rewardCampaignWriteSchema.safeParse(mutated((c) => (c.endDay = "2026-11-08"))).success, true);
});

test("write: a campaign longer than CAMPAIGN_DAYS_MAX days is refused, exactly CAMPAIGN_DAYS_MAX is fine", () => {
  const startMs = Date.UTC(2026, 10, 1);
  const dayOf = (offset: number): string => new Date(startMs + offset * MS_PER_DAY).toISOString().slice(0, 10);
  const at = (days: number) => mutated((c) => ((c.startDay = dayOf(0)), (c.endDay = dayOf(days - 1))));
  assert.equal(rewardCampaignWriteSchema.safeParse(at(CAMPAIGN_DAYS_MAX)).success, true);
  assert.equal(refusedAt(at(CAMPAIGN_DAYS_MAX + 1), "endDay"), true);
});

test("write: 'picked' needs ids; 'everyone' takes none; a duplicate id is refused; more than the cap is refused", () => {
  assert.equal(refusedAt(mutated((c) => (c.customerIds = [])), "customerIds"), true);
  assert.equal(refusedAt(mutated((c) => (c.audience = "everyone")), "customerIds"), true);
  assert.equal(refusedAt(mutated((c) => (c.customerIds = [ID_A, ID_A])), "customerIds"), true);
  const many = Array.from({ length: CAMPAIGN_CUSTOMERS_MAX + 1 }, (_, i) => i.toString(16).padStart(24, "0"));
  assert.equal(refusedAt(mutated((c) => (c.customerIds = many)), "customerIds"), true);
  assert.equal(refusedAt(mutated((c) => (c.customerIds = ["not-an-id"])), "customerIds.0"), true);
});

test("write: an all-'No reward' box, duplicate option ids and min > max are refused (the level box rules)", () => {
  const box = (options: unknown[]) => mutated((c) => (c.box = { scratchDays: 5, useDays: 14, options }));
  assert.equal(refusedAt(box([{ id: "a1", kind: "none", weight: 1 }, { id: "a2", kind: "none", weight: 1 }]), "box.options"), true);
  const dup = box([{ id: "a1", kind: "bill-flat", weight: 1, min: 10, max: 20 }, { id: "a1", kind: "none", weight: 1 }]);
  assert.equal(refusedAt(dup, "box.options.1.id"), true);
  assert.equal(refusedAt(box([{ id: "a1", kind: "bill-flat", weight: 1, min: 30, max: 20 }]), "box.options.0.max"), true);
  assert.equal(refusedAt(box([]), "box.options"), true);
  const tooMany = Array.from({ length: REWARD_OPTIONS_PER_SLOT_MAX + 1 }, (_, i) => ({ id: `o${i}`, kind: "bill-flat", weight: 1, min: 10, max: 10 }));
  assert.equal(refusedAt(box(tooMany), "box.options"), true);
});

test("write: unknown keys are refused at the top level, in the box and in the end body (strict)", () => {
  assert.equal(rewardCampaignWriteSchema.safeParse({ ...valid(), extra: 1 }).success, false);
  assert.equal(rewardCampaignWriteSchema.safeParse(mutated((c) => (c.box = { ...(c.box as object), step: 3 }))).success, false);
  assert.equal(rewardCampaignEndSchema.safeParse({ end: true, extra: 1 }).success, false);
});

test("write: the name must be non-blank and at most REWARD_TITLE_MAX_LEN characters; maxCards has bounds", () => {
  assert.equal(refusedAt(mutated((c) => (c.name = "   ")), "name"), true);
  assert.equal(refusedAt(mutated((c) => (c.name = "x".repeat(REWARD_TITLE_MAX_LEN + 1))), "name"), true);
  assert.equal(rewardCampaignWriteSchema.safeParse(mutated((c) => (c.name = "x".repeat(REWARD_TITLE_MAX_LEN)))).success, true);
  assert.equal(refusedAt(mutated((c) => (c.maxCards = 0)), "maxCards"), true);
  assert.equal(refusedAt(mutated((c) => (c.maxCards = CAMPAIGN_MAX_CARDS_MAX + 1)), "maxCards"), true);
  assert.equal(refusedAt(mutated((c) => (c.maxCards = 1.5)), "maxCards"), true);
});

test("end: only { end: true } is accepted", () => {
  assert.equal(rewardCampaignEndSchema.safeParse({ end: true }).success, true);
  assert.equal(rewardCampaignEndSchema.safeParse({ end: false }).success, false);
  assert.equal(rewardCampaignEndSchema.safeParse({}).success, false);
});

// ── Window + status ────────────────────────────────────────────────────────────────────────────────────────────────
test("campaignWindow: first day 00:00 IST to the last day 23:59:59.999 IST, both inclusive", () => {
  const { startsAt, endsAt } = campaignWindow("2026-11-08", "2026-11-10");
  assert.equal(startsAt.getTime(), Date.UTC(2026, 10, 8) - IST_OFFSET_MS);
  assert.equal(endsAt.getTime(), Date.UTC(2026, 10, 11) - IST_OFFSET_MS - 1);
  assert.equal(startsAt.toISOString(), "2026-11-07T18:30:00.000Z");
  const one = campaignWindow("2026-11-08", "2026-11-08");
  assert.equal(one.endsAt.getTime() - one.startsAt.getTime(), MS_PER_DAY - 1);
});

test("campaignDays counts the first and last day (1 for a one-day campaign)", () => {
  assert.equal(campaignDays("2026-11-08", "2026-11-08"), 1);
  assert.equal(campaignDays("2026-11-08", "2026-11-10"), 3);
  assert.equal(campaignDays("2026-02-27", "2026-03-02"), 4);
});

test("campaignStatusAt: inclusive at both ends", () => {
  const w = { startsAt: 1000, endsAt: 2000 };
  assert.equal(campaignStatusAt(w, 999), "upcoming");
  assert.equal(campaignStatusAt(w, 1000), "live");
  assert.equal(campaignStatusAt(w, 2000), "live");
  assert.equal(campaignStatusAt(w, 2001), "ended");
});

test("campaignIssueKey is camp:<id>", () => {
  assert.equal(campaignIssueKey(ID_A), `camp:${ID_A}`);
});

// ── READ twin ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("parseStoredCampaignBox: null on junk, accepts a stored box (loose: extra keys do not narrow it)", () => {
  for (const junk of [null, undefined, 3, "x", [], {}, { scratchDays: 5, useDays: 14 }, { scratchDays: 5, useDays: 14, options: [] }]) {
    assert.equal(parseStoredCampaignBox(junk), null);
  }
  const stored = { scratchDays: 5, useDays: 14, options: [{ id: "a1", kind: "none", weight: 1 }], futureKey: true };
  const parsed = parseStoredCampaignBox(stored);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.options.length, 1);
  assert.equal(parsed?.scratchDays, 5);
});
