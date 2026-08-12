"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";
import { STALE_TIMES, GC_TIMES } from "@/lib/query";
import type { Settings, UpdateSettingsInput } from "@/types";

export const SETTINGS_KEYS = {
  all: ["settings"] as const,
};

// Restaurant + receipt settings (singleton, cached 10min to mirror the backend
// TTL). Read on the POS, order detail, and settings pages.
export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEYS.all,
    queryFn: () => apiGet<Settings>("/api/settings"),
    staleTime: STALE_TIMES.SETTINGS,
    gcTime: GC_TIMES.SETTINGS,
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: (data: UpdateSettingsInput) =>
      apiSend<Settings>("/api/settings", "PUT", data),
    onSuccess: () => {
      toast.success("Settings saved");
      // The dashboard layout's tab title is server-rendered from Settings —
      // refresh so a renamed restaurant/logo shows up without a full reload.
      router.refresh();
    },
    onError: (err: Error) =>
      toast.error(err.message || "Could not save settings"),
    onSettled: () => qc.invalidateQueries({ queryKey: SETTINGS_KEYS.all }),
  });
}
