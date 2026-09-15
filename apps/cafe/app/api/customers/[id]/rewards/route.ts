import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { getSettings } from "@/lib/settings";
import { resolveLoyaltyConfig } from "@/lib/diner-loyalty";
import type { ResolvedMilestone } from "@pos/shared/loyalty-rules";
import { success, notFound, requireAuth, serverError } from "@/lib/api-helpers";
import { maskCustomer } from "@/lib/customer-privacy";

export const dynamic = "force-dynamic";

// CB-5B S9 — the STAFF-side stamp read that feeds the reward picker (slice B
// owns the client; this is its only server dependency). Deliberately its own
// route rather than a field on GET /api/customers: that list is cached
// process-wide for TTL.CUSTOMERS (2min) via LIST_FIELDS, but `stamps` moves on
// every settle and every cancel — serving it from that cache would show a
// stale balance and let the counter pre-select a rung the server then refuses
// (the exact 400 this slice exists to prevent). This route is uncached and
// costs one indexed findById, same cost class as a single customer fetch.

// One rung of the owner-configured ladder, shaped for the counter to render
// and pre-filter. `affordable` is STAMPS-ONLY (`stamps >= at`) — it does NOT
// evaluate `minBill`: this route has no bill, `minBill` depends on the LIVE
// cart total, which only the client knows and which changes on every item
// added/removed. `minBill` is passed through unevaluated so the client can
// apply that gate itself (slice B), exactly mirroring how
// lib/reward-redemption.ts's decideRedemption checks stamps before minBill.
export interface StaffRewardRung {
  at: number;
  kind: ResolvedMilestone["kind"];
  value: number;
  item: string;
  qty: number;
  minBill: number | null;
  affordable: boolean;
  // Two rows in the RAW stored ladder share this `at`, so the claim gate
  // refuses it as "ambiguous-reward". Reported separately from `affordable`
  // because the counter can do nothing about it — the owner has to fix the
  // ladder in Settings — and saying "not enough stamps" about a full card
  // would send them chasing the wrong thing.
  ambiguous: boolean;
}

export interface CustomerRewardsResponse {
  stamps: number;
  rungs: StaffRewardRung[];
}

// GET /api/customers/[id]/rewards — the counter's reward picker data: the
// customer's RAW stamp balance plus the ladder, each rung marked affordable
// by stamps alone. Raw stamps, never `cyclePosition`: the server's own claim
// gate (lib/reward-claim.ts -> decideRedemption) reads `customer.stamps`
// directly, and `cyclePosition` (stamps % cycleLength) is a different number
// once a diner has looped the ladder — pre-selecting a rung by cyclePosition
// would get it refused with a 400 the moment stamps exceed one cycle.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authed = await requireAuth();
  if ("error" in authed) return authed.error;
  const role = authed.session.user.role;

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) return notFound("Customer not found");

  try {
    await connectDB();
    const raw = await Customer.findById(id).select("stamps").lean();
    if (!raw) return notFound("Customer not found");
    // The projection above deliberately selects NO personal field, so this
    // mask is an exact no-op today (maskCustomer only rewrites a string
    // `mobile`). It is in the path anyway, and on the RAW document rather than
    // the derived response, so the privacy rule holds STRUCTURALLY: the day
    // someone widens the projection to show the counter a name or a number,
    // the masking already happens instead of having to be remembered. The
    // completeness sweep in lib/customer-privacy-paths.test.ts requires this
    // of every route under app/api/customers/ for exactly that reason.
    const customer = maskCustomer(raw, role);

    const settings = await getSettings();
    const { ladder } = resolveLoyaltyConfig(settings);
    const stamps = customer.stamps ?? 0;

    // AMBIGUOUS RUNGS, mirrored from the claim gate's own RAW check
    // (lib/reward-claim.ts findMilestoneAt): `normalizeMilestones` DEDUPES a
    // duplicate `at` and keeps the first row, so a ladder the normalizer has
    // cleaned looks perfectly ordinary here — while the claim gate re-reads the
    // RAW rows, sees two matches, and refuses with "ambiguous-reward". Without
    // this the picker would not merely offer such a rung, it would AUTO-SELECT
    // it (pickDefaultRung takes the highest usable one), and every create and
    // add-round would 400 — the counter could not take the order at all.
    // Today's settings form cannot save a duplicate (the schema's superRefine
    // rejects it), so this is the legacy/direct-write document the claim gate's
    // own comment names. Marked NOT affordable rather than dropped, so the
    // counter still sees the rung exists and can have the ladder fixed.
    const rawAtCounts = new Map<number, number>();
    for (const row of settings?.loyaltyRules?.milestones ?? []) {
      rawAtCounts.set(row.at, (rawAtCounts.get(row.at) ?? 0) + 1);
    }

    const rungs: StaffRewardRung[] = ladder.milestones.map((m) => ({
      at: m.at,
      kind: m.kind,
      value: m.value,
      item: m.item,
      qty: m.qty,
      minBill: m.minBill,
      // Two gates, both mirroring the server's own claim path: the stamp
      // balance (decideRedemption) and rung ambiguity (findMilestoneAt).
      affordable: stamps >= m.at && (rawAtCounts.get(m.at) ?? 0) <= 1,
      ambiguous: (rawAtCounts.get(m.at) ?? 0) > 1,
    }));

    const response: CustomerRewardsResponse = { stamps, rungs };
    return success(response);
  } catch (error) {
    return serverError("Failed to load customer rewards", error);
  }
}
