"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES, REFETCH_INTERVALS } from "@/lib/query";
import { KITCHEN_KEYS } from "@/hooks/use-kitchen";
import { applyTokenAction, type TokenAction, type TokenBoard } from "@/lib/token-view";

// Print customization S8 — the token board's data hooks (the POS token sheet now; S9's Now Serving screen reuses
// useTokenBoard with background polling). The action has its OWN mutationKey under TOKEN_KEYS.all, so a realtime
// nudge is held while a mark is in flight (TOKEN_REALTIME) and the optimistic row never bounces.
export const TOKEN_KEYS = {
  all: ["tokens"] as const,
  action: ["tokens", "action"] as const,
};

interface UseTokenBoardOptions {
  /** Only fetch (and poll) while something shows the board — the sheet mounts its body only while open. */
  enabled: boolean;
  /** A wall screen is never the focused tab: keep polling in the background (the Kitchen board's rule). */
  background?: boolean;
}

// Same cadence as the Kitchen board (REFETCH_INTERVALS.KITCHEN, 01-PLAN §3.6): realtime nudges come first, the poll
// is the fallback and the source of truth.
export function useTokenBoard({ enabled, background = false }: UseTokenBoardOptions) {
  return useQuery({
    queryKey: TOKEN_KEYS.all,
    queryFn: () => apiGet<TokenBoard>("/api/tokens"),
    enabled,
    staleTime: STALE_TIMES.LIVE,
    refetchInterval: enabled ? REFETCH_INTERVALS.KITCHEN : false,
    refetchIntervalInBackground: background,
  });
}

export interface TokenActionInput {
  id: string;
  action: TokenAction;
  /** Ready only: the entry's firedAt — the newest round this screen could see (the P4-C stamp bound). */
  seenFiredAt?: string;
}

// Optimistic, with an explicit snapshot restore on failure (never invalidate-only: a racing refetch could re-adopt
// the failed write's state). Settling refreshes the token board AND the Kitchen board — a Ready from the POS clears
// the kitchen card too.
export function useTokenAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: TOKEN_KEYS.action,
    mutationFn: ({ id, action, seenFiredAt }: TokenActionInput) =>
      apiSend<{ id: string; action: TokenAction }>(
        `/api/tokens/${encodeURIComponent(id)}`,
        "POST",
        action === "ready" && seenFiredAt ? { action, seenFiredAt } : { action },
      ),
    onMutate: async ({ id, action }) => {
      await qc.cancelQueries({ queryKey: TOKEN_KEYS.all });
      const previous = qc.getQueryData<TokenBoard>(TOKEN_KEYS.all);
      if (previous) {
        qc.setQueryData<TokenBoard>(TOKEN_KEYS.all, applyTokenAction(previous, id, action, new Date().toISOString()));
      }
      return { previous };
    },
    onError: (err: Error, _input, context) => {
      if (context?.previous) qc.setQueryData(TOKEN_KEYS.all, context.previous);
      toast.error(err.message || "Could not update that token");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TOKEN_KEYS.all });
      qc.invalidateQueries({ queryKey: KITCHEN_KEYS.all });
    },
  });
}
