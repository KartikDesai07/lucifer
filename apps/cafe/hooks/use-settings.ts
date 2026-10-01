"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import type { Settings, UpdateSettingsInput } from "@/types";

export const SETTINGS_KEYS = {
  all: ["settings"] as const,
};

// Restaurant + receipt settings (singleton). Master data: seeded once per page
// load from GET /api/bootstrap (MasterDataProvider) and read from the tab's own
// copy afterwards, so the freshness window is the blob's 24h, not the backend
// TTL — a save commits the saved document to this key in the same tab
// (useUpdateSettings → commitSettings), and a page refresh re-fetches the bootstrap. Read on the POS, order detail,
// and settings pages.
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEYS.all,
    queryFn: () => apiGet<Settings>("/api/settings"),
    staleTime: STALE_TIMES.MASTERS,
    gcTime: GC_TIMES.MASTERS,
  });
}

// A save commits the document the PUT returned (the DB's own copy, the same
// lean shape GET serves) — the commitAreas shape in hooks/use-areas.ts: cancel
// first so an older read in flight cannot land over it, and commit through a
// real fetch so MasterDataProvider also writes the device's stored copy (a
// manual setQueryData never reaches it). A plain re-read instead could be
// answered by another instance's 45s settings cache with the PRE-save copy,
// and the settings screens render loaded data over a refetch error — a form
// remounted from that copy would save the old values back.
export async function commitSettings(qc: QueryClient, saved: Settings): Promise<Settings> {
  await qc.cancelQueries({ queryKey: SETTINGS_KEYS.all, exact: true });
  await qc.invalidateQueries({ queryKey: SETTINGS_KEYS.all, exact: true, refetchType: "none" });
  return qc.fetchQuery({
    queryKey: SETTINGS_KEYS.all,
    queryFn: () => Promise.resolve(saved),
    staleTime: 0,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (data: UpdateSettingsInput) =>
      apiSend<Settings>("/api/settings", "PUT", data),
    onSuccess: async (saved) => {
      // A commit cancelled by a newer read is harmless: that read is newer.
      await commitSettings(qc, saved).catch(() => undefined);
      toast.success("Settings saved");
      // The dashboard layout's tab title is server-rendered from Settings —
      // refresh so a renamed restaurant/logo shows up without a full reload.
      router.refresh();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Could not save settings");
      // The save may still have landed (a lost response): re-read.
      void qc.invalidateQueries({ queryKey: SETTINGS_KEYS.all });
    },
  });
}
