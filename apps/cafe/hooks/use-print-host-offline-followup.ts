"use client";

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { PosPulseData } from "@pos/shared/self-order-alert";
import { POS_PULSE_KEYS } from "@/hooks/use-pos-pulse";

// W-O -- a host that has just been away reads "offline" for up to one more poll
// after its beats resume: the cached pulse was fetched before the beat landed.
// When a beat is answered as the host while that stale flag is still showing,
// refresh the pulse ONCE (re-armed the next time the cache reads online, so a
// server that keeps saying offline can never turn this into a refetch loop).
export function useOfflineFollowUp(): () => void {
  const qc = useQueryClient();
  const armed = useRef(true);
  return useCallback(() => {
    const showsOffline = qc.getQueryData<PosPulseData>(POS_PULSE_KEYS.all)?.printHost?.offline === true;
    if (!showsOffline) {
      armed.current = true;
      return;
    }
    if (!armed.current) return;
    armed.current = false;
    void qc.invalidateQueries({ queryKey: POS_PULSE_KEYS.all });
  }, [qc]);
}
