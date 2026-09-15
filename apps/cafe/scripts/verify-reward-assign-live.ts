/**
 * CB-5D part 2 — live-DB leg for the reward ASSIGNMENT + counter/QR shared
 * promo fence + rung-earn TTL bookkeeping.
 *
 * WHY THIS EXISTS: three new DB-truths a fake port cannot prove:
 *   A. claimRewardStamps' `assignment` param must append to Customer.rewards
 *      in the SAME update as the stamp debit, and a RETRY with the SAME
 *      caller-supplied `assignedAt` must not duplicate the $addToSet element
 *      (a fresh Date would make it compare unequal and double-append).
 *   B. claimPromoRedemption/releasePromoRedemption's claimant union must fence
 *      ONE human across BOTH the QR-request and counter-order surfaces via
 *      canonicalPromoMobile — this is the owner's flagged hazard.
 *   C. grantStampForSettledOrder's rungEarnedAt Map must round-trip through a
 *      real `.lean()` read as a PLAIN OBJECT (a prior agent found `.get()`
 *      throws on a lean result) and an absent entry must read as "no
 *      deadline", never epoch-0.
 *   D. CB-5D part 2 DEFECT FIX (review-found, live-probed): a claim's
 *      compensation must un-assign what the claim assigned, not just refund
 *      the stamps. Probed against real mongod BEFORE the fix: claim 8 stamps
 *      -> stamps 0, rewards 1; cancel -> stamps 8, rewards STILL 1 — the
 *      customer keeps both the stamps and a live code, repeatably. Scenarios
 *      15-22 pin the fixed `returnRewardStamps(..., assignment)` 4th param
 *      and the cancel-path sibling `releaseAssignedRewardForRung`.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_assign npm run verify:reward-assign:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops what it touches. Prints pass/fail only, never the URI.
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { claimRewardStamps, returnRewardStamps, type RewardAssignment } from "@/lib/reward-redemption";
import { releaseAssignedRewardForRung } from "@/lib/assigned-reward-gate";
import { buildRewardAssignment } from "@/lib/reward-assignment";
import {
  claimPromoRedemption,
  releasePromoRedemption,
  type PromoClaimant,
} from "@/lib/order-request-accept-promo";
import { PromoRedemption } from "@/models/PromoRedemption";
import { grantStampForSettledOrder } from "@/lib/diner-loyalty-earn";
import type { ISettings } from "@/models/Settings";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";
import { isRungClaimWindowClosed } from "@pos/shared/public-promo";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}assign`;

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

// A resolved flat-money milestone whose promoCode may be set per scenario.
function flatMilestone(
  at: number,
  value: number,
  promoCode: string | null = null,
  claimWithinDays: number | null = null,
): ResolvedMilestone {
  return {
    at,
    kind: "flat",
    value,
    item: "",
    itemProductId: null,
    qty: 1,
    minBill: null,
    promoCode,
    claimWithinDays,
  };
}

async function freshCustomer(stamps: number): Promise<mongoose.Types.ObjectId> {
  const c = await Customer.create({
    name: "Assign Test Diner",
    mobile: `9${Math.floor(100000000 + Math.random() * 899999999)}`,
    stamps,
  });
  return c._id as mongoose.Types.ObjectId;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = uri.split("/").pop()?.split("?")[0] ?? "";
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    console.error(`Refusing to run: database "${dbName}" is not a ${SCRATCH_PREFIX}* scratch DB.`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`\nreward assign live — live against ${dbName}\n`);

  let orderSeq = 0;
  const nextOrderId = () => `ORD-ASSIGNLEG-${(orderSeq += 1).toString().padStart(4, "0")}`;

  try {
    // ── A1 — claim + assign lands atomically, read back from the DB ────────
    await scenario(
      1,
      "A1: claimRewardStamps debits stamps AND appends the assignment to Customer.rewards in ONE update",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignedAt = new Date();
        const assignment: RewardAssignment = {
          code: "FLAT20", at: 8, kind: "flat", assignedAt,
        };

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(claimed, true, "the claim must land for a funded balance");

        const stored = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(stored!.stamps, 12, "20 - 8 = 12 after the debit");
        assert.equal(stored!.rewards?.length, 1, "exactly one assigned reward must be stored");
        assert.equal(stored!.rewards?.[0]!.code, "FLAT20", "the assigned code must round-trip");
        assert.equal(stored!.rewards?.[0]!.at, 8, "the assigned rung must round-trip");
        assert.equal(
          stored!.rewards?.[0]!.assignedAt.getTime(),
          assignedAt.getTime(),
          "assignedAt must round-trip exactly as supplied",
        );
      },
    );

    // ── A2 — retry idempotency: SAME orderId + SAME assignment must NOT
    // duplicate the rewards element ────────────────────────────────────────
    await scenario(
      2,
      "A2 REGRESSION: retrying claimRewardStamps with the SAME orderId and the SAME assignment object leaves rewards.length === 1",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignedAt = new Date();
        const assignment: RewardAssignment = {
          code: "FLAT20", at: 8, kind: "flat", assignedAt,
        };

        const first = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(first, true, "sanity: the first claim lands");

        // Re-derive the same customer row's redeemedOrders state: since this
        // is the FIRST claim for this orderId (no prior return), the filter's
        // `redeemedOrders:{$ne:orderId}` arm is what admits a "retry" here —
        // simulating a caller (e.g. a crash-retried settle) calling again
        // with the identical assignment object BEFORE any return happened
        // would be refused by the filter (matchedCount 0), which is correct:
        // a same-orderId retry that never returned is a double-spend, not an
        // idempotent retry. The idempotent-retry path this scenario must
        // prove is the documented one: claim -> return -> claim again with
        // the SAME assignment must not duplicate the element.
        const returned = await returnRewardStamps(customerId.toString(), orderId, 8);
        assert.equal(returned, true, "sanity: the compensating return lands");

        const second = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(second, true, "RETRY CLAIM after a return must succeed (the lockout regression, S3B)");

        const stored = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(stored!.stamps, 12, "20 - 8 = 12 after the retry re-lands the debit");
        assert.equal(
          stored!.rewards?.length,
          1,
          "the $addToSet element (assignment) must NOT duplicate on retry — assignedAt is caller-supplied so the " +
            "element compares equal; a fresh Date here would make this 2",
        );
      },
    );

    // ── A3 — no promoCode => no rewards key at all (omit-empty) ────────────
    await scenario(
      3,
      "A3: a rung with NO promoCode passes undefined as the assignment and writes NO rewards key at all",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, undefined);
        assert.equal(claimed, true, "sanity: the claim itself still lands");

        const stored = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(stored!.stamps, 12, "20 - 8 = 12");
        // Vision guard for the absence pin: a positive landmark (stamps
        // really did move) sits right above, so this isn't a no-op write.
        assert.equal(stored!.rewards, undefined, "no rewards key may appear when the assignment was undefined");
      },
    );

    // ── A4 — buildRewardAssignment returns undefined for an absent/inactive
    // code, and the claim that follows assigns nothing ─────────────────────
    await scenario(
      4,
      "A4: buildRewardAssignment returns undefined for a code absent from settings.promoCodes or with active:false, and the claim then assigns nothing",
      async () => {
        const promoCodes = [
          { code: "STALE10", kind: "flat" as const, value: 10, active: false, minSubtotal: undefined },
        ];
        const now = new Date();

        // 4a — code names something entirely absent from the list.
        const msAbsent = flatMilestone(5, 20, "GHOST99");
        const assignedAbsent = buildRewardAssignment(msAbsent, promoCodes, now);
        assert.equal(assignedAbsent, undefined, "a promoCode absent from settings.promoCodes must build undefined");

        // 4b — code IS present but active:false.
        const msInactive = flatMilestone(5, 20, "STALE10");
        const assignedInactive = buildRewardAssignment(msInactive, promoCodes, now);
        assert.equal(assignedInactive, undefined, "a promoCode with active:false must build undefined");

        // The claim itself must still land (the rung's ordinary benefit was
        // still validly spent), but with nothing assigned — read back from DB.
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const claimed = await claimRewardStamps(customerId.toString(), orderId, 5, assignedInactive);
        assert.equal(claimed, true, "the claim must still land even though nothing was assigned");
        const stored = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(stored!.stamps, 15, "20 - 5 = 15");
        assert.equal(stored!.rewards, undefined, "a stale/inactive code must assign nothing, stored or not");
      },
    );

    // ── A5 — expiresAt derivation: validDays present vs absent ─────────────
    await scenario(
      5,
      "A5: a code with validDays produces expiresAt = assignedAt + validDays days; a code with no validDays stores NO expiresAt key",
      async () => {
        const VALID_DAYS = 7;
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        const promoCodes = [
          { code: "SEVENDAY", kind: "flat" as const, value: 20, active: true, validDays: VALID_DAYS },
          { code: "FOREVER", kind: "flat" as const, value: 20, active: true },
        ];
        const assignedAt = new Date();

        // 5a — validDays present.
        const msExpiring = flatMilestone(5, 20, "SEVENDAY");
        const withExpiry = buildRewardAssignment(msExpiring, promoCodes, assignedAt);
        assert.ok(withExpiry, "a valid active code must build an assignment");
        assert.equal(
          withExpiry!.expiresAt?.getTime(),
          assignedAt.getTime() + VALID_DAYS * ONE_DAY_MS,
          "expiresAt must equal assignedAt + validDays days, exactly",
        );

        // Round-trip through a real write/read.
        const customerId = await freshCustomer(20);
        const claimed = await claimRewardStamps(customerId.toString(), nextOrderId(), 5, withExpiry);
        assert.equal(claimed, true);
        const stored = await Customer.findById(customerId).select("rewards").lean();
        assert.equal(
          stored!.rewards?.[0]!.expiresAt?.getTime(),
          assignedAt.getTime() + VALID_DAYS * ONE_DAY_MS,
          "expiresAt must round-trip through a real Mongoose write/read",
        );

        // 5b — no validDays => no expiresAt key at all.
        const msForever = flatMilestone(5, 20, "FOREVER");
        const noExpiry = buildRewardAssignment(msForever, promoCodes, assignedAt);
        assert.ok(noExpiry, "a valid active code with no validDays must still build an assignment");
        assert.equal("expiresAt" in noExpiry!, false, "a code with no validDays must omit the expiresAt KEY, not store it as undefined");

        const customerId2 = await freshCustomer(20);
        const claimed2 = await claimRewardStamps(customerId2.toString(), nextOrderId(), 5, noExpiry);
        assert.equal(claimed2, true);
        const stored2 = await Customer.findById(customerId2).select("rewards").lean();
        assert.equal(stored2!.rewards?.[0]!.code, "FOREVER", "landmark: the reward row itself must exist");
        assert.equal(stored2!.rewards?.[0]!.expiresAt, undefined, "a code with no validDays must read back with NO expiresAt");
      },
    );

    // ── B1 — THE CORE ASSERTION: one human cannot spend a once-per-customer
    // code twice across request vs order surfaces, mobile re-typed 3 ways ──
    await scenario(
      6,
      "B1 CORE: request-claim then order-claim for the SAME human's mobile (typed 3 different ways) is REJECTED every time — canonicalPromoMobile collapses them to one fence",
      async () => {
        const code = "ONCE50";
        const mobileTyped = "9876543210";
        const requestId = new mongoose.Types.ObjectId().toString();

        const firstClaim = await claimPromoRedemption(code, mobileTyped, { kind: "request", id: requestId });
        assert.equal(firstClaim, "claimed", "sanity: the first claim (request surface) must land");

        const variants: Array<{ mobile: string; claimant: PromoClaimant }> = [
          { mobile: "+919876543210", claimant: { kind: "order", id: nextOrderId() } },
          { mobile: "09876543210", claimant: { kind: "order", id: nextOrderId() } },
          { mobile: "9876543210", claimant: { kind: "order", id: nextOrderId() } },
        ];
        for (const v of variants) {
          const decision = await claimPromoRedemption(code, v.mobile, v.claimant);
          assert.equal(
            decision,
            "reject",
            `an order-surface claim for the same human's mobile typed as "${v.mobile}" must be REJECTED`,
          );
        }

        // Vision guard: exactly ONE row exists for this code — the fence
        // really is shared, not silently multiplying rows per mobile spelling.
        const rows = await PromoRedemption.find({ code }).lean();
        assert.equal(rows.length, 1, "exactly one PromoRedemption row must exist for this code — the fence is ONE row, not one per spelling");
        assert.equal(rows[0]!.requestId?.toString(), requestId, "the surviving row must be the ORIGINAL request claim");
      },
    );

    // ── B2 — replay resumes for BOTH claimant kinds ─────────────────────────
    await scenario(
      7,
      "B2: the SAME claimant claiming twice returns replay (not reject), for BOTH claimant kinds",
      async () => {
        const requestId = new mongoose.Types.ObjectId().toString();
        const first = await claimPromoRedemption("REPLAY1", "9111111111", { kind: "request", id: requestId });
        assert.equal(first, "claimed");
        const replay = await claimPromoRedemption("REPLAY1", "9111111111", { kind: "request", id: requestId });
        assert.equal(replay, "replay", "the SAME requestId claiming again must replay, not reject");

        const orderId = nextOrderId();
        const firstOrder = await claimPromoRedemption("REPLAY2", "9222222222", { kind: "order", id: orderId });
        assert.equal(firstOrder, "claimed");
        const replayOrder = await claimPromoRedemption("REPLAY2", "9222222222", { kind: "order", id: orderId });
        assert.equal(replayOrder, "replay", "the SAME orderId claiming again must replay, not reject");
      },
    );

    // ── B3 — a DIFFERENT claimant of the same kind collides ─────────────────
    await scenario(
      8,
      "B3: two DIFFERENT orderIds claiming the same code+mobile collide — reject",
      async () => {
        const mobile = "9333333333";
        const first = await claimPromoRedemption("COLLIDE1", mobile, { kind: "order", id: nextOrderId() });
        assert.equal(first, "claimed");
        const second = await claimPromoRedemption("COLLIDE1", mobile, { kind: "order", id: nextOrderId() });
        assert.equal(second, "reject", "a different orderId for the same code+mobile must be rejected");
      },
    );

    // ── B4 — release frees a counter claim WITHOUT deleting a diner's row for
    // the same code+mobile ──────────────────────────────────────────────────
    await scenario(
      9,
      "B4: releasePromoRedemption({kind:'order'}) frees a counter claim, and does NOT delete a diner's row for the same code+mobile",
      async () => {
        const code = "RELEASE1";
        const mobile = "9444444444";
        const requestId = new mongoose.Types.ObjectId().toString();

        const requestClaim = await claimPromoRedemption(code, mobile, { kind: "request", id: requestId });
        assert.equal(requestClaim, "claimed", "sanity: the request claims first");

        // A DIFFERENT claimant (order) then attempts to release its OWN claim
        // (never claimed — it never landed since the request already holds
        // the fence). Prove release targets ONLY the matching claimant field
        // by releasing an order id that never claimed anything for this
        // code+mobile: the request's row must be untouched either way.
        const otherOrderId = nextOrderId();
        await releasePromoRedemption({ kind: "order", id: otherOrderId });

        const survivingRequestRow = await PromoRedemption.findOne({ code, mobile: "9444444444" }).lean();
        assert.ok(survivingRequestRow, "the request's row must survive an unrelated order-claimant release");
        assert.equal(survivingRequestRow!.requestId?.toString(), requestId, "landmark: it is still the request's own row");

        // Now prove the release DOES free a genuine counter claim: claim a
        // FRESH code as an order, release it, and show the row is gone.
        const code2 = "RELEASE2";
        const orderId2 = nextOrderId();
        const orderClaim = await claimPromoRedemption(code2, mobile, { kind: "order", id: orderId2 });
        assert.equal(orderClaim, "claimed", "sanity: the order claims a fresh code");
        await releasePromoRedemption({ kind: "order", id: orderId2 });
        const releasedRow = await PromoRedemption.findOne({ code: code2, mobile: "9444444444" }).lean();
        assert.equal(releasedRow, null, "a genuine counter claim must be gone after its own release");
      },
    );

    // ── B5 — release refuses to free a row whose orderId is already
    // backfilled ─────────────────────────────────────────────────────────────
    await scenario(
      10,
      "B5: release refuses to free a row whose orderId is already backfilled (the orderId-absent filter half)",
      async () => {
        const code = "BACKFILLED1";
        const mobile = "9555555555";
        const requestId = new mongoose.Types.ObjectId().toString();

        const claim = await claimPromoRedemption(code, mobile, { kind: "request", id: requestId });
        assert.equal(claim, "claimed");

        // Simulate the best-effort backfill that runs after a successful
        // order write — orderId gets set on the row.
        await PromoRedemption.updateOne({ code, mobile }, { $set: { orderId: "ORD-BACKFILLED-0001" } });

        await releasePromoRedemption({ kind: "request", id: requestId });

        const row = await PromoRedemption.findOne({ code, mobile }).lean();
        assert.ok(row, "a backfilled row must SURVIVE a release attempt — the accept already succeeded");
        assert.equal(row!.orderId, "ORD-BACKFILLED-0001", "landmark: the backfilled orderId is still present, proving this wasn't deleted by chance");
      },
    );

    // ── B6 — the counter-shaped row (claimOrderId, no requestId) really
    // persists ───────────────────────────────────────────────────────────────
    await scenario(
      11,
      "B6: a counter-shaped row (claimOrderId set, no requestId) really persists in the DB — this is what required the schema change",
      async () => {
        const code = "COUNTERSHAPE1";
        const mobile = "9666666666";
        const orderId = nextOrderId();

        const claim = await claimPromoRedemption(code, mobile, { kind: "order", id: orderId });
        assert.equal(claim, "claimed");

        const row = await PromoRedemption.findOne({ code, mobile }).lean();
        assert.ok(row, "the counter row must exist");
        assert.equal(row!.claimOrderId, orderId, "claimOrderId must be stored");
        assert.equal(row!.requestId, undefined, "a counter row must carry NO requestId key at all (omit-empty)");
      },
    );

    // ── C1 — grantStampForSettledOrder writes rungEarnedAt.<at> on a rung
    // count, and nothing for a non-rung count ──────────────────────────────
    await scenario(
      12,
      "C1: a settled bill that lands the customer's stamps ONTO a configured rung writes rungEarnedAt.<at>; a non-rung count writes NOTHING",
      async () => {
        const settingsWithLadder = {
          dinerAccountsEnabled: true,
          loyaltyEnabled: true,
          loyaltyMinBill: 0,
          loyaltyRules: { milestones: [{ at: 2, kind: "flat", value: 20, qty: 1 }] },
        } as unknown as ISettings;
        const now = Date.now();

        // First bill -> stamps: 1 (not a rung: ladder only configures at:2).
        const customerId = await freshCustomer(0);
        const orderId1 = nextOrderId();
        const grant1 = await grantStampForSettledOrder(settingsWithLadder, customerId.toString(), orderId1, 500, now);
        assert.equal(grant1.granted, true, "sanity: the first stamp must land");
        const afterFirst = await Customer.findById(customerId).select("stamps rungEarnedAt").lean();
        assert.equal(afterFirst!.stamps, 1, "landmark: the stamp itself did land");
        assert.equal(
          afterFirst!.rungEarnedAt,
          undefined,
          "a non-rung count (1, when the ladder configures 2) must write NO rungEarnedAt key at all",
        );

        // Second bill -> stamps: 2, which IS the configured rung.
        const orderId2 = nextOrderId();
        const grant2 = await grantStampForSettledOrder(settingsWithLadder, customerId.toString(), orderId2, 500, now);
        assert.equal(grant2.granted, true, "sanity: the second stamp must land");
        const afterSecond = await Customer.findById(customerId).select("stamps rungEarnedAt").lean();
        assert.equal(afterSecond!.stamps, 2, "landmark: the count really did reach the rung");
        assert.ok(afterSecond!.rungEarnedAt, "a rung count (2) MUST write a rungEarnedAt map");
      },
    );

    // ── C2 — the map reads back as a PLAIN OBJECT through .lean(), the exact
    // shape order-request-reward.ts reads ───────────────────────────────────
    await scenario(
      13,
      "C2: rungEarnedAt reads back through .lean() as a PLAIN OBJECT — customer.rungEarnedAt?.[String(at)] resolves to a real Date, .get() throws",
      async () => {
        const settingsWithLadder = {
          dinerAccountsEnabled: true,
          loyaltyEnabled: true,
          loyaltyMinBill: 0,
          loyaltyRules: { milestones: [{ at: 1, kind: "flat", value: 20, qty: 1 }] },
        } as unknown as ISettings;
        const now = Date.now();
        const customerId = await freshCustomer(0);
        const orderId = nextOrderId();

        const grant = await grantStampForSettledOrder(settingsWithLadder, customerId.toString(), orderId, 500, now);
        assert.equal(grant.granted, true, "sanity: the rung-1 stamp must land");

        const leaned = await Customer.findById(customerId).select("rungEarnedAt").lean();
        // Positive landmark: the exact indexing shape order-request-reward.ts
        // uses actually resolves to a Date.
        const at1 = leaned!.rungEarnedAt?.["1"];
        assert.ok(at1 instanceof Date, "customer.rungEarnedAt?.[String(at)] must resolve to a real Date on a lean() read");
        assert.equal(at1!.getTime(), now, "the stored timestamp must equal the injected `now`");

        // Vision guard for the "plain object, not a Map" claim: .get() must
        // throw (or at least not behave like Map.get) on the lean result —
        // proving this isn't a Mongoose Map instance masquerading as one.
        assert.equal(
          typeof (leaned!.rungEarnedAt as unknown as { get?: unknown }).get,
          "undefined",
          "a lean() read must NOT expose a Map's .get method — it is a plain object, not a hydrated Map",
        );
      },
    );

    // ── C3 — a customer with NO rungEarnedAt entry is not refused by the
    // window gate ────────────────────────────────────────────────────────────
    await scenario(
      14,
      "C3: a customer with NO rungEarnedAt entry reads as 'no deadline' through the real gate — never refused as 1970/expired",
      async () => {
        // A pre-existing customer who has stamps but never crossed a rung
        // under this feature (no rungEarnedAt key at all).
        const customerId = await freshCustomer(5);
        const leaned = await Customer.findById(customerId).select("rungEarnedAt").lean();
        const rungMap: Record<string, Date> | undefined = leaned!.rungEarnedAt;
        // The EXACT read shape order-request-reward.ts uses — computed BEFORE
        // the narrowing assert below so TS's control-flow analysis doesn't
        // collapse rungMap (and this expression) to `never` afterward.
        const earnedAtMs: number | undefined = rungMap?.[String(3)]?.getTime();

        assert.ok(rungMap === undefined, "sanity fixture: this customer truly has no rungEarnedAt");
        assert.equal(earnedAtMs, undefined, "an absent rung entry must read as undefined, not 0/epoch");

        const closed = isRungClaimWindowClosed(earnedAtMs, 5, Date.now());
        assert.equal(
          closed,
          false,
          "an absent earn time must NEVER read as an expired window — every pre-existing customer would be locked out",
        );
      },
    );
    // ── D1 — THE EXPLOIT IS CLOSED: claim + assign, then return with the
    // assignment -> stamps refunded AND the reward row GONE ─────────────────
    await scenario(
      15,
      "D1 REGRESSION (CB-5D part 2): returnRewardStamps(..., assignment) refunds stamps AND removes the exact assigned rewards row",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignedAt = new Date();
        const assignment: RewardAssignment = { code: "FLAT20", at: 8, kind: "flat", assignedAt };

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(claimed, true, "sanity: the claim lands");
        const afterClaim = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(afterClaim!.stamps, 12, "sanity: 20 - 8 = 12 after the claim");
        assert.equal(afterClaim!.rewards?.length, 1, "sanity: exactly one assigned reward after the claim");

        const returned = await returnRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(returned, true, "the return must fire");

        const afterReturn = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(afterReturn!.stamps, 20, "THE EXPLOIT IS CLOSED: stamps must be refunded back to 20");
        assert.equal(
          afterReturn!.rewards?.length ?? 0,
          0,
          "THE EXPLOIT IS CLOSED: the assigned reward row must be GONE, not left behind alongside the refund",
        );
      },
    );

    // ── D2 — a SPENT code survives a reversal (the audit-trail guard) ───────
    await scenario(
      16,
      "D2: a code already marked usedAt SURVIVES returnRewardStamps — the fence row's audit trail is never erased by a later reversal",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignedAt = new Date();
        const assignment: RewardAssignment = { code: "SPENT20", at: 8, kind: "flat", assignedAt };

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(claimed, true, "sanity: the claim lands");

        // Simulate the code having been spent (markAssignedRewardUsed's own
        // write shape) BEFORE the order is reversed.
        await Customer.updateOne(
          { _id: customerId, "rewards.code": "SPENT20" },
          { $set: { "rewards.$.usedAt": new Date(), "rewards.$.orderId": "ORD-SPEND-CONSUMER" } },
        );
        const afterSpend = await Customer.findById(customerId).select("rewards").lean();
        assert.ok(afterSpend!.rewards?.[0]!.usedAt, "sanity fixture: the row really is marked spent");

        const returned = await returnRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(returned, true, "the stamp refund itself must still fire");

        const afterReturn = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(afterReturn!.stamps, 20, "landmark: the stamps DID refund");
        assert.equal(afterReturn!.rewards?.length, 1, "a SPENT grant must REMAIN — its usedAt fences the $pull out");
        assert.ok(afterReturn!.rewards?.[0]!.usedAt, "the surviving row must still carry its usedAt — the audit trail is intact");
      },
    );

    // ── D3 — an OLDER unrelated grant of the SAME code is not collateral
    // damage ─────────────────────────────────────────────────────────────────
    await scenario(
      17,
      "D3: two claims of the SAME code with DIFFERENT assignedAt — returning the newer pulls ONLY the newer, the older survives",
      async () => {
        const customerId = await freshCustomer(20);

        const olderOrderId = nextOrderId();
        const olderAssignedAt = new Date(Date.now() - 60_000);
        const olderAssignment: RewardAssignment = { code: "DUPCODE", at: 5, kind: "flat", assignedAt: olderAssignedAt };
        const olderClaim = await claimRewardStamps(customerId.toString(), olderOrderId, 5, olderAssignment);
        assert.equal(olderClaim, true, "sanity: the older claim lands");

        const newerOrderId = nextOrderId();
        const newerAssignedAt = new Date();
        const newerAssignment: RewardAssignment = { code: "DUPCODE", at: 5, kind: "flat", assignedAt: newerAssignedAt };
        const newerClaim = await claimRewardStamps(customerId.toString(), newerOrderId, 5, newerAssignment);
        assert.equal(newerClaim, true, "sanity: the newer claim lands");

        const afterBoth = await Customer.findById(customerId).select("rewards").lean();
        assert.equal(afterBoth!.rewards?.length, 2, "sanity: two distinct grants of the same code both stored (different assignedAt)");

        const returned = await returnRewardStamps(customerId.toString(), newerOrderId, 5, newerAssignment);
        assert.equal(returned, true, "the newer order's return must fire");

        const afterReturn = await Customer.findById(customerId).select("rewards").lean();
        assert.equal(afterReturn!.rewards?.length, 1, "exactly ONE grant must remain after pulling the newer");
        assert.equal(
          afterReturn!.rewards?.[0]!.assignedAt.getTime(),
          olderAssignedAt.getTime(),
          "the SURVIVOR must be the OLDER grant — the newer order's return must never touch an unrelated grant of the same code",
        );
      },
    );

    // ── D4 — the no-assignment path is byte-unchanged ───────────────────────
    await scenario(
      18,
      "D4: claim/return with NO 4th argument round-trips stamps and creates NO rewards key at all, unchanged by the D1-D3 fix",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8);
        assert.equal(claimed, true, "sanity: the claim lands with no assignment");
        const afterClaim = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(afterClaim!.stamps, 12, "20 - 8 = 12");
        assert.equal(afterClaim!.rewards, undefined, "no assignment => no rewards key after the claim");

        const returned = await returnRewardStamps(customerId.toString(), orderId, 8);
        assert.equal(returned, true, "the return must fire");
        const afterReturn = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(afterReturn!.stamps, 20, "stamps must round-trip back to 20");
        assert.equal(afterReturn!.rewards, undefined, "no rewards key may ever be created by the no-assignment path");
      },
    );

    // ── D5 — the reciprocal double-return guard is still intact ─────────────
    await scenario(
      19,
      "D5: a SECOND returnRewardStamps for the same orderId is refused — the original reciprocal guard survives the assignment param",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignedAt = new Date();
        const assignment: RewardAssignment = { code: "DBLRETURN", at: 8, kind: "flat", assignedAt };

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(claimed, true, "sanity: the claim lands");

        const firstReturn = await returnRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(firstReturn, true, "sanity: the first return fires");

        const secondReturn = await returnRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(secondReturn, false, "DOUBLE-RETURN must still be refused by the returnedOrders:{$ne:orderId} filter arm");

        const stored = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(stored!.stamps, 20, "landmark: the stamps must NOT have been refunded twice (still 20, not 28)");
      },
    );

    // ── D6 — THE CANCEL SHAPE: returnRewardStamps called with exactly 3 args
    // (as cancel/route.ts does), followed by releaseAssignedRewardForRung ───
    await scenario(
      20,
      "D6 CANCEL SHAPE: returnRewardStamps(id, orderId, cost) with only 3 args, then releaseAssignedRewardForRung(id, at) — stamps refunded AND the code released",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignedAt = new Date();
        const assignment: RewardAssignment = { code: "CANCELSHAPE", at: 8, kind: "flat", assignedAt };

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(claimed, true, "sanity: the claim lands");

        // EXACTLY the call shape app/api/orders/[id]/cancel/route.ts uses:
        // returnRewardStamps invoked with only 3 args (no assignment — the
        // Order document never stored one), immediately followed by the
        // rung-keyed release using the Order's own `rewardAt`.
        const returned = await returnRewardStamps(customerId.toString(), orderId, 8);
        assert.equal(returned, true, "the 3-arg return (cancel's exact call shape) must still fire");
        await releaseAssignedRewardForRung(customerId.toString(), assignment.at);

        const stored = await Customer.findById(customerId).select("stamps rewards").lean();
        assert.equal(stored!.stamps, 20, "stamps must be refunded back to 20");
        assert.equal(
          stored!.rewards?.length ?? 0,
          0,
          "THE CANCEL SHAPE must also close the exploit: the rung-keyed release must remove the grant",
        );
      },
    );

    // ── D7 — releaseAssignedRewardForRung must not touch a DIFFERENT rung's
    // grant ──────────────────────────────────────────────────────────────────
    await scenario(
      21,
      "D7: releaseAssignedRewardForRung(id, at) releases ONLY that rung's grant — a grant at a DIFFERENT `at` survives",
      async () => {
        const customerId = await freshCustomer(20);

        const orderA = nextOrderId();
        const assignmentA: RewardAssignment = { code: "RUNG5", at: 5, kind: "flat", assignedAt: new Date() };
        const claimedA = await claimRewardStamps(customerId.toString(), orderA, 5, assignmentA);
        assert.equal(claimedA, true, "sanity: rung-5 claim lands");

        const orderB = nextOrderId();
        const assignmentB: RewardAssignment = { code: "RUNG8", at: 8, kind: "flat", assignedAt: new Date() };
        const claimedB = await claimRewardStamps(customerId.toString(), orderB, 8, assignmentB);
        assert.equal(claimedB, true, "sanity: rung-8 claim lands");

        const beforeRelease = await Customer.findById(customerId).select("rewards").lean();
        assert.equal(beforeRelease!.rewards?.length, 2, "sanity: both grants stored");

        await releaseAssignedRewardForRung(customerId.toString(), 8);

        const afterRelease = await Customer.findById(customerId).select("rewards").lean();
        assert.equal(afterRelease!.rewards?.length, 1, "exactly one grant must remain after releasing rung 8");
        assert.equal(afterRelease!.rewards?.[0]!.at, 5, "the SURVIVOR must be the DIFFERENT rung (5) — a release must never touch another rung's grant");
      },
    );

    // ── D8 — releaseAssignedRewardForRung must not remove a SPENT grant of
    // that rung ──────────────────────────────────────────────────────────────
    await scenario(
      22,
      "D8: releaseAssignedRewardForRung must NOT remove a SPENT grant of that same rung — usedAt fences the $pull out",
      async () => {
        const customerId = await freshCustomer(20);
        const orderId = nextOrderId();
        const assignment: RewardAssignment = { code: "RUNGSPENT", at: 8, kind: "flat", assignedAt: new Date() };

        const claimed = await claimRewardStamps(customerId.toString(), orderId, 8, assignment);
        assert.equal(claimed, true, "sanity: the claim lands");

        await Customer.updateOne(
          { _id: customerId, "rewards.code": "RUNGSPENT" },
          { $set: { "rewards.$.usedAt": new Date(), "rewards.$.orderId": "ORD-RUNGSPENT-CONSUMER" } },
        );
        const beforeRelease = await Customer.findById(customerId).select("rewards").lean();
        assert.ok(beforeRelease!.rewards?.[0]!.usedAt, "sanity fixture: the grant really is marked spent");

        await releaseAssignedRewardForRung(customerId.toString(), 8);

        const afterRelease = await Customer.findById(customerId).select("rewards").lean();
        assert.equal(afterRelease!.rewards?.length, 1, "a SPENT grant of this rung must SURVIVE the release — its audit trail is never erased");
        assert.ok(afterRelease!.rewards?.[0]!.usedAt, "the surviving row must still carry its usedAt");
      },
    );
  } finally {
    await Customer.deleteMany({});
    await PromoRedemption.deleteMany({});
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "live leg failed");
  process.exit(1);
});
