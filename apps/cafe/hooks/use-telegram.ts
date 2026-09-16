"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiSend } from "@/lib/api-client";

// CR2.3b §21.9 — TanStack seam for the Settings → Telegram tab. Every
// mutation invalidates on HOOK-LEVEL onSettled (never a per-call callback):
// a per-call onSettled is skipped once the component that issued it has
// unmounted (e.g. the Setup card closing mid-request), which would strand
// stale status/chat/invite data — hook-level onSettled always fires
// regardless of what's still mounted (repo memory lesson). Callers must
// depend only on `.mutate`/`.mutateAsync` from the returned mutation object
// — useMutation() returns a NEW object identity on every render, so storing
// the object itself (not just the stable function) in an effect dependency
// array loops.

export const TELEGRAM_KEYS = {
  status: ["telegram", "status"] as const,
  chats: ["telegram", "chats"] as const,
  invites: ["telegram", "invites"] as const,
};

export interface TelegramStatus {
  state: "absent" | "ok" | "unreadable";
  paused: boolean;
  botUsername: string | null;
  botId: string | null;
  webhookUrl: string | null;
  webhookSetAt: string | null;
  activeChats: number;
  erroringChats: number;
  live: { urlMatches: boolean; pendingUpdateCount: number; lastErrorMessage: string | null } | null;
  liveError: boolean;
}

export interface TelegramChatRow {
  chatId: string;
  chatType: "private" | "group" | "supergroup" | "channel";
  title: string;
  active: boolean;
  types: string[];
  connectedAt: string;
  lastSendAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: number;
  deactivatedReason?: "blocked" | "not_found" | "removed" | "migrated";
}

export interface TelegramInviteRow {
  code: string;
  label: string;
  expiresAt: string;
  deepLink: string | null;
}

export function useTelegramStatus() {
  return useQuery({
    queryKey: TELEGRAM_KEYS.status,
    queryFn: () => apiGet<TelegramStatus>("/api/telegram/status"),
  });
}

export function useTelegramChats() {
  return useQuery({
    queryKey: TELEGRAM_KEYS.chats,
    queryFn: () => apiGet<TelegramChatRow[]>("/api/telegram/chats"),
  });
}

export function useTelegramInvites() {
  return useQuery({
    queryKey: TELEGRAM_KEYS.invites,
    queryFn: () => apiGet<TelegramInviteRow[]>("/api/telegram/invites"),
  });
}

// Connect (or re-validate + re-mint + re-setWebhook for) a bot token. A
// bot CHANGE means every old chat 403-deactivates on its first send — the
// caller's success UI should say so.
export function useConnectTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiSend<{ username: string; botId: string; webhookUrl: string | null; webhookSet: boolean }>(
        "/api/telegram/connect",
        "POST",
        { token },
      ),
    onError: (err: Error) => toast.error(err.message || "Could not connect the bot"),
    onSettled: () => qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.status }),
  });
}

export function useDisconnectTelegram() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend<{ webhookDeleted: boolean }>("/api/telegram/connect", "DELETE"),
    onSuccess: (data) => {
      if (data.webhookDeleted) {
        toast.success("Telegram disconnected");
      } else {
        toast.warning(
          "Disconnected, but the webhook may still be registered — regenerate the token via BotFather /token to force-invalidate.",
        );
      }
    },
    onError: (err: Error) => toast.error(err.message || "Could not disconnect the bot"),
    onSettled: () => qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.status }),
  });
}

export function useRepairWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend<{ webhookUrl: string | null; webhookSet: boolean }>("/api/telegram/repair", "POST"),
    onSuccess: (data) => {
      if (data.webhookSet) {
        toast.success("Webhook repaired");
      } else {
        toast.error("Telegram refused the webhook — try again shortly.");
      }
    },
    onError: (err: Error) => toast.error(err.message || "Could not repair the webhook"),
    onSettled: () => qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.status }),
  });
}

export function useMintInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (label: string) => apiSend<TelegramInviteRow>("/api/telegram/invites", "POST", { label }),
    onError: (err: Error) => toast.error(err.message || "Could not create an invite"),
    onSettled: () => qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.invites }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      apiSend<{ revoked: boolean }>(`/api/telegram/invites/${encodeURIComponent(code)}`, "DELETE"),
    onError: (err: Error) => toast.error(err.message || "Could not revoke the invite"),
    onSettled: () => qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.invites }),
  });
}

export interface UpdateTelegramChatInput {
  chatId: string;
  types?: string[];
  active?: boolean;
}

export function useUpdateTelegramChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ chatId, ...patch }: UpdateTelegramChatInput) =>
      apiSend<{ updated: boolean }>(`/api/telegram/chats/${encodeURIComponent(chatId)}`, "PATCH", patch),
    onSuccess: (data) => {
      if (!data.updated) {
        toast.error("Could not update that chat — refresh and try again");
      }
    },
    onError: (err: Error) => toast.error(err.message || "Could not update that chat"),
    // Returning the invalidation promises keeps isPending true until the
    // refetch settles — TanStack v5 awaits a returned onSettled promise, so
    // the disabled={...isPending} checkboxes stay guarded through the stale
    // window instead of re-enabling on cached data (repo memory lesson).
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.chats }),
        qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.status }),
      ]),
  });
}

export function useRemoveTelegramChat() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) =>
      apiSend<{ removed: boolean }>(`/api/telegram/chats/${encodeURIComponent(chatId)}`, "DELETE"),
    onSuccess: (data) => {
      if (data.removed) {
        toast.success("Chat removed");
      } else {
        toast.error("Could not remove that chat — refresh and try again");
      }
    },
    onError: (err: Error) => toast.error(err.message || "Could not remove that chat"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.chats });
      qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.status });
    },
  });
}

// Result is DATA, not a thrown error: `ok:false` is a normal successful
// response (a Telegram-side send failure), so no onError toast fires here —
// the caller renders `data.ok` itself.
export function useTelegramTestSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) =>
      apiSend<{ chatId: string; ok: boolean; errorCode?: number }>("/api/telegram/test-send", "POST", { chatId }),
    onError: (err: Error) => toast.error(err.message || "Could not send the test message"),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.chats });
      qc.invalidateQueries({ queryKey: TELEGRAM_KEYS.status });
    },
  });
}
