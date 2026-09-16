"use client";

import { useState } from "react";
import { Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  useTelegramChats,
  useTelegramInvites,
  useUpdateTelegramChat,
  useRemoveTelegramChat,
  useTelegramTestSend,
  useMintInvite,
  useRevokeInvite,
  type TelegramChatRow,
} from "@/hooks/use-telegram";
import {
  TELEGRAM_ALERT_REGISTRY,
  telegramDeepLink,
  type TelegramAlertType,
} from "@pos/shared/telegram-alert";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

const SKELETON_ROWS = 3;

interface TelegramChatsListProps {
  // Used ONLY as the fallback source for a deep link the invite payload
  // itself didn't carry (§21.7) — never rendered directly (no cafe name).
  botUsername: string | null;
}

// CR2.3b §21.9 — the second half of TelegramSetupCard's "ok" state: the
// registered chats (with per-type toggles from TELEGRAM_ALERT_REGISTRY) and
// the "add a person" invite flow.
export function TelegramChatsList({ botUsername }: TelegramChatsListProps) {
  const chats = useTelegramChats();
  const invites = useTelegramInvites();
  const updateChat = useUpdateTelegramChat();
  const removeChat = useRemoveTelegramChat();
  const testSend = useTelegramTestSend();
  const mintInvite = useMintInvite();
  const revokeInvite = useRevokeInvite();

  const [removing, setRemoving] = useState<string | null>(null);
  const [label, setLabel] = useState("");

  const toggleType = (row: TelegramChatRow, type: TelegramAlertType, checked: boolean) => {
    const next = checked ? [...row.types, type] : row.types.filter((t) => t !== type);
    updateChat.mutate({ chatId: row.chatId, types: next });
  };

  const sendTest = (chatId: string) => {
    testSend.mutate(chatId, {
      onSuccess: (data) => {
        if (data.ok) {
          toast.success("Test message sent");
        } else {
          toast.error(
            `Telegram couldn't deliver the test message${data.errorCode ? ` (code ${data.errorCode})` : ""}`,
          );
        }
      },
    });
  };

  const mint = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    mintInvite.mutate(trimmed, { onSuccess: () => setLabel("") });
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link).then(
      () => toast.success("Link copied"),
      () => toast.error("Could not copy the link"),
    );
  };

  return (
    <div className="space-y-4 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Connected chats</p>
        {chats.isLoading ? (
          <div className="mt-2 space-y-2">
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : chats.isPaused ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Offline — chats will load once the connection is back.
          </p>
        ) : chats.isLoadingError ? (
          <p className="mt-2 text-sm text-destructive">
            Couldn&apos;t load chats. {(chats.error as Error)?.message ?? ""}
          </p>
        ) : !chats.data || chats.data.length === 0 ? (
          <EmptyState
            className="mt-2"
            title="No chats connected yet"
            description="Add a person below to get an invite link."
          />
        ) : (
          <div className="mt-2 space-y-2">
            {chats.data.map((row) => (
              <div key={row.chatId} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.chatType}
                      {!row.active &&
                        ` · deactivated${row.deactivatedReason ? ` (${row.deactivatedReason})` : ""}`}
                    </p>
                  </div>
                  <Badge variant={row.active ? "outline" : "destructive"}>
                    {row.active ? "Active" : "Deactivated"}
                  </Badge>
                </div>

                <div className="mt-2 space-y-1.5">
                  {TELEGRAM_ALERT_REGISTRY.map((meta) => (
                    <label key={meta.type} className="flex items-start gap-2 text-xs">
                      <Checkbox
                        checked={row.types.includes(meta.type)}
                        onCheckedChange={(c) => toggleType(row, meta.type, c === true)}
                        disabled={updateChat.isPending || chats.isFetching}
                      />
                      <span>
                        <span className="font-medium">{meta.label}</span>
                        <span className="block text-muted-foreground">{meta.description}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={testSend.isPending}
                    onClick={() => sendTest(row.chatId)}
                  >
                    Send test
                  </Button>
                  {!row.active && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updateChat.isPending || chats.isFetching}
                      onClick={() => updateChat.mutate({ chatId: row.chatId, active: true })}
                    >
                      Reactivate
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setRemoving(row.chatId)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium">Add a person</p>
        <div className="mt-2 flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Kitchen phone"
            disabled={mintInvite.isPending}
          />
          <Button type="button" onClick={mint} disabled={mintInvite.isPending || !label.trim()}>
            {mintInvite.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Invite
          </Button>
        </div>

        {invites.isLoading ? (
          <Skeleton className="mt-2 h-10 w-full" />
        ) : invites.isPaused && !invites.data ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Offline — invites will load once the connection is back.
          </p>
        ) : invites.isLoadingError ? (
          <p className="mt-2 text-xs text-destructive">
            Couldn&apos;t load invites. {(invites.error as Error)?.message ?? ""}
          </p>
        ) : invites.data && invites.data.length > 0 ? (
          <div className="mt-2 space-y-2">
            {invites.data.map((inv) => {
              // The API payload's own deepLink is authoritative; the local
              // builder is only a fallback for a payload that lacks it.
              const link = inv.deepLink ?? (botUsername ? telegramDeepLink(botUsername, inv.code) : null);
              return (
                <div key={inv.code} className="flex items-center justify-between gap-2 rounded-md border p-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{inv.label}</p>
                    <p className="text-muted-foreground">Expires {formatDate(inv.expiresAt)}</p>
                    {link && (
                      <Input
                        readOnly
                        value={link}
                        className="mt-1 h-7 text-xs"
                        onFocus={(e) => e.currentTarget.select()}
                      />
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {link && (
                      <Button type="button" size="sm" variant="outline" onClick={() => copyLink(link)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={revokeInvite.isPending}
                      onClick={() => revokeInvite.mutate(inv.code)}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No pending invites.</p>
        )}
      </div>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove this chat?"
        description="This stops all Telegram alerts to this chat. It can be reconnected later with a new invite."
        confirmLabel="Remove"
        isLoading={removeChat.isPending}
        onConfirm={() =>
          removing &&
          removeChat.mutate(removing, {
            onSuccess: (data) => {
              if (data.removed) setRemoving(null);
            },
          })
        }
      />
    </div>
  );
}
