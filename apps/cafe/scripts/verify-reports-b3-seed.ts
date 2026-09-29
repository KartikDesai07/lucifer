/**
 * Seed builder for scripts/verify-reports-b3-live.ts — split out to keep the
 * live leg itself under the file-size budget. Every hand-computed number in
 * that file's comments/assertions is derived from these rules directly
 * (CHANNEL_EXPR/channelOf precedence, foldHeat's weekday averaging,
 * insightRange's 7-day/28-day fallback) — nothing here calls the folds under
 * test. A single product ("Cup" @ ₹100/unit) is used for every line so every
 * order's `total` is an exact, easy-to-check multiple, keeping the type/hour
 * arithmetic free of GST/discount/charge noise (those money rules are already
 * proven by the batch-2 leg — not this slice's job).
 *
 * ── Calendar ───────────────────────────────────────────────────────────────
 * NOW = 2026-09-29T09:00:00Z = 14:30 IST, Tue 29 Sep 2026 (same clock as the
 * b2 leg). RANGE = 27-29 Sep (Sun/Mon/Tue). Its compare window (shift 3 days)
 * is 24-26 Sep, clipped to 14:30 IST on the 26th. Its insight window (< 7
 * days -> the 28-day fallback ending on `to`) is 2-29 Sep. WEEK_RANGE (21-29
 * Sep, 9 days, >=7) is its OWN insight window — no fallback. ONE_DAY_RANGE
 * (29 Sep) shares the SAME 2-29 Sep insight window as the 3-day range
 * (insightRange only depends on `range.to`). EXTRA_WEEK (8-14 Sep, exactly 7
 * days) is additional coverage (not in the spec's mandated range list) whose
 * only order (H2) is a plain counter bill — the one place a whole
 * DashboardChannel ('qr'/'takeaway'/'dine-in') is genuinely ABSENT from a
 * >=7-day window, so heat.byType for those keys is provably `hours: []`.
 *
 * ── Order-type precedence coverage (CHANNEL_EXPR / channelOf) ─────────────
 * O4 carries source:"qr" AND parcel:true AND a tableNo -> proves qr wins over
 * both. O8 carries parcel:true AND a tableNo -> proves takeaway wins over
 * dine-in. O9 carries tableNo:"" explicitly (not undefined) -> proves the
 * empty-string branch of CHANNEL_EXPR's $strLenCP check still resolves to
 * counter (must equal O1/O5/O6/O11's undefined-tableNo counter, not a 4th
 * bucket).
 *
 * ── Non-counting fixtures ───────────────────────────────────────────────────
 * OX (Cancelled) and OY (Pending) both sit in the RANGE's busiest hour
 * (28 Sep, hour 13) with large totals (500 each) — if either leaked into the
 * fold, hour 13's/kpis' numbers would be very visibly wrong. O15 is a
 * Completed order dated AFTER `NOW` (14:45 IST vs the 14:30 IST clock) —
 * proves currentWindow's clip, not just a status filter, excludes it.
 *
 * ── Day-attribution boundary ────────────────────────────────────────────────
 * O5 (27 Sep 23:50 IST) and O6 (28 Sep 00:10 IST) are 20 minutes apart in
 * real time but land on different IST calendar days/hours (23 vs 0) —
 * exercises the CAFE_TIMEZONE hour/day derivation at the boundary.
 *
 * ── Busiest-hour tie ────────────────────────────────────────────────────────
 * RANGE hour 10 and hour 11 both have 4 orders; hour 10's sales (560) beat
 * hour 11's (440), so busiestHour must resolve to 10 by the "then most
 * sales" tiebreak, not just "first hour seen".
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { Order } from "@/models/Order";

const IST_OFFSET_MS = 330 * 60 * 1000;

function ist(localNoZ: string): Date {
  return new Date(new Date(`${localNoZ}Z`).getTime() - IST_OFFSET_MS);
}

export interface SeedResult {
  /** Every seeded Completed order, with its hand-assigned id, for per-doc channelOf() identity checks. */
  channelDocs: Array<{ id: string; source?: string; parcel?: boolean; tableNo?: string }>;
}

export async function seedReportsB3(): Promise<SeedResult> {
  const orderId = (label: string) => `SCRATCH-RPTB3-${randomUUID().slice(0, 8)}-${label}`;
  const line = (qty: number, price = 100) => ({
    productId: new mongoose.Types.ObjectId(),
    name: "Cup",
    price,
    qty,
    modifiers: [],
    instructions: "",
    kotRound: 1,
  });
  type OrderDoc = Record<string, unknown>;
  const baseOrder = (id: string, createdAt: Date, qty: number, total: number, over: OrderDoc = {}): OrderDoc => ({
    orderId: orderId(id),
    customerName: "Walk-In",
    items: [line(qty, total / qty)],
    subtotal: total,
    discount: 0,
    gstAmount: 0,
    total,
    paidAmount: total,
    payment: "Cash",
    status: "Completed",
    receiver: "Verifier",
    kotRounds: 1,
    createdAt,
    ...over,
  });

  const channelDocs: SeedResult["channelDocs"] = [];
  const track = (id: string, over: OrderDoc) => {
    channelDocs.push({
      id,
      source: over.source as string | undefined,
      parcel: over.parcel as boolean | undefined,
      tableNo: over.tableNo as string | undefined,
    });
    return over;
  };

  // ═══════════════════════════ RANGE 27-29 Sep ═══════════════════════════
  // Day 27 (Sun): hours 10, 11(x2), 13, 14, 23 — hour 12 is the gap.
  const O1 = baseOrder("d27-counter", ist("2026-09-27T10:00:00"), 1, 100, track("O1", {}));
  const O2 = baseOrder("d27-dinein", ist("2026-09-27T11:00:00"), 2, 200, track("O2", { tableNo: "T-1" }));
  const O3b = baseOrder("d27-takeaway-b", ist("2026-09-27T11:00:00"), 1, 40, track("O3b", { parcel: true }));
  const O3 = baseOrder("d27-takeaway", ist("2026-09-27T13:00:00"), 1, 100, track("O3", { parcel: true }));
  // O4: source qr + parcel:true + a tableNo ALL AT ONCE — qr must win.
  const O4 = baseOrder(
    "d27-qr-wins",
    ist("2026-09-27T14:00:00"),
    1,
    100,
    track("O4", { source: "qr", parcel: true, tableNo: "T-2" }),
  );
  // O5: 23:50 IST 27th -> IST hour 23, day 27 (day-attribution boundary pair with O6).
  const O5 = baseOrder("d27-late-hour23", ist("2026-09-27T23:50:00"), 1, 50, track("O5", {}));

  // Day 28 (Mon): hours 0, 10(x2), 11, 13, 14 — hour 12 is the gap.
  // O6: 00:10 IST 28th -> IST hour 0, day 28 (the other half of the boundary pair).
  const O6 = baseOrder("d28-midnight-hour0", ist("2026-09-28T00:10:00"), 1, 50, track("O6", {}));
  const O7 = baseOrder("d28-dinein", ist("2026-09-28T10:00:00"), 1, 100, track("O7", { tableNo: "T-1" }));
  const O8b = baseOrder("d28-dinein-b", ist("2026-09-28T10:00:00"), 1, 260, track("O8b", { tableNo: "T-5" }));
  // O8: parcel:true AND a tableNo — takeaway must win over dine-in.
  const O8 = baseOrder(
    "d28-takeaway-wins",
    ist("2026-09-28T11:00:00"),
    1,
    100,
    track("O8", { parcel: true, tableNo: "T-3" }),
  );
  // O9: tableNo explicitly "" (not undefined) — must still resolve to counter.
  const O9 = baseOrder("d28-empty-tableno", ist("2026-09-28T13:00:00"), 1, 100, track("O9", { tableNo: "" }));
  const O10 = baseOrder("d28-dinein-c", ist("2026-09-28T14:00:00"), 3, 300, track("O10", { tableNo: "T-4" }));
  // OX/OY: Cancelled + Pending, SAME hot hour (28th, hour 13) as O9 — must NOT count anywhere.
  const OX = baseOrder("d28-cancelled-hot-hour", ist("2026-09-28T13:30:00"), 5, 500, { status: "Cancelled", paidAmount: 0 });
  const OY = baseOrder("d28-pending-hot-hour", ist("2026-09-28T13:40:00"), 5, 500, { status: "Pending", paidAmount: 0 });

  // Day 29 (Tue, today): hours 10, 11, 13, 14 (before the 14:30 IST cutoff).
  const O11 = baseOrder("d29-counter", ist("2026-09-29T10:00:00"), 1, 100, track("O11", {}));
  const O12 = baseOrder("d29-dinein", ist("2026-09-29T11:00:00"), 1, 100, track("O12", { tableNo: "T-1" }));
  const O13 = baseOrder("d29-qr", ist("2026-09-29T13:00:00"), 1, 100, track("O13", { source: "qr" }));
  const O14 = baseOrder("d29-takeaway", ist("2026-09-29T14:00:00"), 1, 100, track("O14", { parcel: true }));
  // O15: Completed but dated AFTER NOW (14:45 IST vs the 14:30 IST clock) — must be excluded by currentWindow, not merely uncounted by luck.
  const O15 = baseOrder("d29-after-now", ist("2026-09-29T14:45:00"), 1, 999, track("O15", {}));

  // ═══════════════════ Heat-only markers (insight window 2-29 Sep) ═══════════════════
  // H1: 2 Sep (Wed), hour 9 — the earliest day the 28-day fallback window includes.
  const H1 = baseOrder("heat-in-window", ist("2026-09-02T09:00:00"), 1, 100, track("H1", {}));
  // H0: 1 Sep (Tue), hour 9 — ONE DAY before the fallback window starts; must NEVER
  // appear in any heat grid for the 3-day/1-day ranges (proves the exact boundary).
  const H0 = baseOrder("heat-outside-window", ist("2026-09-01T09:00:00"), 1, 999, track("H0", {}));
  // H2/H3/H4/H5: same weekday+hour (Tuesday, hour 14) on 4 different weeks —
  // together with O14 (29th, also Tue hour14) that's 5 orders over 4 Tuesdays
  // in the 2-29 Sep window = avg 1.25 -> rounds to 1.3 (one-decimal rounding).
  const H2 = baseOrder("heat-tue14-w1", ist("2026-09-08T14:00:00"), 1, 100, track("H2", {}));
  const H3 = baseOrder("heat-tue14-w2a", ist("2026-09-15T14:00:00"), 1, 100, track("H3", {}));
  const H4 = baseOrder("heat-tue14-w2b", ist("2026-09-15T14:00:00"), 1, 150, track("H4", { tableNo: "T-9" }));
  const H5 = baseOrder("heat-tue14-w3", ist("2026-09-22T14:00:00"), 1, 100, track("H5", { parcel: true }));

  // ═══════════════════ Compare window (24-26 Sep) ═══════════════════
  const C1 = baseOrder("cmp-in-window", ist("2026-09-24T10:00:00"), 1, 70, track("C1", {}));
  // C2: 26 Sep, 10:00 IST — BEFORE the 14:30 IST same-time-of-day clip -> included.
  const C2 = baseOrder("cmp-before-cutoff", ist("2026-09-26T10:00:00"), 1, 80, track("C2", { tableNo: "T-1" }));
  // C3: 26 Sep, 15:00 IST — AFTER the clip -> excluded from kpis.previous (still a
  // real Completed order, so it legitimately shows up in the wider heat windows).
  const C3 = baseOrder("cmp-after-cutoff", ist("2026-09-26T15:00:00"), 1, 999, track("C3", {}));

  await Order.insertMany([
    O1, O2, O3b, O3, O4, O5, O6, O7, O8b, O8, O9, O10, OX, OY, O11, O12, O13, O14, O15,
    H1, H0, H2, H3, H4, H5, C1, C2, C3,
  ]);
  console.log(`Seeded ${channelDocs.length} channel-tracked Completed orders + 2 non-counting (Cancelled/Pending) + 1 excluded-by-clock.\n`);

  return { channelDocs };
}
