import { useEffect, useState } from "react";

import { apiGet } from "@/lib/api-client";

interface TableChargeInfo {
  tableNo: string;
  charge: { amount: number; label: string } | null;
  // Owner field-feedback 2026-08-20 — the charge is only quoted on the
  // table's first order of a session; false means an open tab or an
  // in-flight request already covers it. See lib/order-request-intake.ts's
  // tableChargeAppliesNow (the SAME rule the route bills off of).
  chargeApplies: boolean;
}

export interface PublicTableCharge {
  tableCharge: { amount: number; label: string } | null;
  // CR2.2c §17.E — the SAME raw signal tableCharge collapses (it folds
  // chargeApplies:false down to `null`, indistinguishable from "no charge
  // configured"). PublicCart needs the raw boolean: a promo is only offered
  // on a table's FIRST order of a session (a second round is a race remnant,
  // not a normal path) — no token (parcel / a name-based /m pick) has no such
  // session concept, so it defaults true (promo shown) and stays true.
  chargeApplies: boolean;
}

// Extracted from PublicOrderFlow.tsx (mechanical, ~300-line cap): a second,
// independent fetch of the SAME route PublicMenu already calls for its own
// header — kept separate rather than lifting PublicMenu's fetch/state up, so
// PublicMenu's existing fetch/error behavior (SLICE 8's edit list) stays
// untouched. Behavior-identical to the original inline effect.
export function usePublicTableCharge(token: string | undefined): PublicTableCharge {
  const [tableCharge, setTableCharge] = useState<{ amount: number; label: string } | null>(null);
  const [chargeApplies, setChargeApplies] = useState(true);

  useEffect(() => {
    if (!token) {
      setTableCharge(null);
      setChargeApplies(true);
      return;
    }
    let active = true;
    apiGet<TableChargeInfo>(`/api/public/table/${encodeURIComponent(token)}`)
      .then((data) => {
        // chargeApplies false means this table's charge was already quoted
        // on an earlier order this session — treat it exactly like "no
        // charge" here, the ONE place this flow decides it, so neither the
        // display total nor PublicCart's own line/total computations (both
        // read this same state) can show a charge the diner won't actually
        // be billed a second time for.
        if (active) {
          setTableCharge(data.chargeApplies ? data.charge : null);
          setChargeApplies(data.chargeApplies);
        }
      })
      .catch(() => {
        // A failed fetch must not confidently HIDE a control the diner could
        // legitimately use — default true, mirroring tableCharge's own
        // null-on-failure fallback (which likewise can't tell "no charge"
        // from "the fetch failed").
        if (active) {
          setTableCharge(null);
          setChargeApplies(true);
        }
      });
    return () => {
      active = false;
    };
  }, [token]);

  return { tableCharge, chargeApplies };
}
