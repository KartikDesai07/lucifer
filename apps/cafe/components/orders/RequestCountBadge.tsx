"use client";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { SidebarMenuBadge } from "@/components/ui/sidebar";

const TRUNCATED_LABEL = "50+";

// The sidebar's "Order Requests" row gets a red round badge so a busy floor
// staff's eye catches it. CR2.3 §20 — reads off the shared PosPulseProvider
// context instead of its own poll now: the provider is the ONE place polling
// /api/order-requests/pulse (see its own hook's comment for why a second
// observer must never re-arm a second timer against that endpoint).
export function RequestCountBadge() {
  const { pulse } = usePosPulseContext();
  const count = pulse?.openCount ?? 0;
  if (count === 0) return null;
  return (
    <SidebarMenuBadge className="min-w-5 rounded-full bg-destructive px-1.5 text-destructive-foreground">
      {pulse?.openTruncated ? TRUNCATED_LABEL : count}
    </SidebarMenuBadge>
  );
}
