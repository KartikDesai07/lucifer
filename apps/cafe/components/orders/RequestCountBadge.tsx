"use client";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { BRAND_NAV_BADGE_CLASS } from "@/components/brand/brand-classes";

const TRUNCATED_LABEL = "50+";

// The nav's "Order Requests" row shows how many requests wait: the owner's HTML count badge (values 2.3, a grey pill
// at the row's end, wide form only). CR2.3 §20: it reads the shared PosPulseProvider context, never a poll of its
// own (the provider is the ONE place polling /api/order-requests/pulse).
//
// The HTML hides a row's badge in the 76px rail, so there a small warn dot sits on the icon's corner instead (the
// request strip's colour): a waiting request must never vanish just because the nav is the rail.
export function RequestCountBadge() {
  const { pulse } = usePosPulseContext();
  const count = pulse?.openCount ?? 0;
  if (count === 0) return null;
  return (
    <>
      <span data-ui="nav-badge" className={BRAND_NAV_BADGE_CLASS}>
        {pulse?.openTruncated ? TRUNCATED_LABEL : count}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-9 top-1.5 size-2 rounded-full bg-status-warn ring-2 ring-nav wide:hidden"
      />
    </>
  );
}
