"use client";

import { usePosPulseContext } from "@/components/layout/PosPulseProvider";
import { usePrintHostContext } from "@/components/layout/PrintHostProvider";
import { navDeviceName, navSubline } from "@/lib/nav-device-name";

// The nav's second lines (design 5.2): "{lead} · {this device's print name}", or the lead alone. A leaf consumer of
// the pulse on purpose (like RequestCountBadge): only this text re-renders per pulse tick, never the nav around it.
export function NavDeviceLine({ lead, className, dataUi }: { lead: string; className?: string; dataUi?: string }) {
  const { pulse } = usePosPulseContext();
  const { deviceId } = usePrintHostContext();
  return (
    <span data-ui={dataUi} className={className}>
      {navSubline(lead, navDeviceName(pulse?.printHost, deviceId))}
    </span>
  );
}
