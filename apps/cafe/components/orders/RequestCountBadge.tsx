"use client";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { SidebarMenuBadge } from "@/components/ui/sidebar";

const TRUNCATED_LABEL = "50+";

// The sidebar's "Order Requests" row gets a red round badge so a busy floor
// staff's eye catches it. CR2.3 §20 — reads off the shared PosPulseProvider
// context instead of its own poll now: the provider is the ONE place polling
// /api/order-requests/pulse (see its own hook's comment for why a second
// observer must never re-arm a second timer against that endpoint).
//
// The primitive hides a menu badge in the 3rem icon rail, so there a red dot
// sits on the icon's corner instead — a waiting request must never vanish
// just because the sidebar is folded. The badge stays white-on-red on an
// active or hovered row (the primitive would otherwise re-colour its text).
export function RequestCountBadge() {
  const { pulse } = usePosPulseContext();
  const count = pulse?.openCount ?? 0;
  if (count === 0) return null;
  return (
    <>
      <SidebarMenuBadge className="right-2 min-w-5 rounded-full bg-brand-danger px-1.5 text-[11px] font-semibold text-white -translate-y-1/2 peer-data-[size=default]/menu-button:top-1/2 peer-hover/menu-button:text-white peer-data-[active=true]/menu-button:text-white">
        {pulse?.openTruncated ? TRUNCATED_LABEL : count}
      </SidebarMenuBadge>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-[22px] top-0.5 hidden size-2.5 rounded-full bg-brand-danger ring-2 ring-sidebar group-data-[collapsible=icon]:block"
      />
    </>
  );
}
