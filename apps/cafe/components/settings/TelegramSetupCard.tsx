"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  useTelegramStatus,
  useConnectTelegram,
  useRepairWebhook,
  useDisconnectTelegram,
} from "@/hooks/use-telegram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ErrorState } from "@/components/shared/ErrorState";
import { TelegramChatsList } from "@/components/settings/TelegramChatsList";

const SKELETON_ROWS = 3;

// CR2.3b §21.9 states A/B/C, driven entirely by useTelegramStatus() — no RHF
// here, credentials never ride the settings PUT (S6 admin routes only).
// Setup copy is deliberately generic: no cafe name anywhere (white-label,
// CLAUDE.md — never hardcode a cafe name in v2 code).
export function TelegramSetupCard() {
  const status = useTelegramStatus();
  const connect = useConnectTelegram();
  const repair = useRepairWebhook();
  const disconnect = useDisconnectTelegram();
  const [token, setToken] = useState("");
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [webhookMayRemain, setWebhookMayRemain] = useState(false);

  const submitToken = () => {
    const trimmed = token.trim();
    if (!trimmed) return;
    connect.mutate(trimmed, {
      onSuccess: () => {
        toast.success("Bot connected");
        setToken("");
        setWebhookMayRemain(false);
      },
    });
  };

  if (status.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telegram bot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // A paused (offline) query reads as no-data/no-error in TanStack v5 — never
  // render the "no token" guide here, or a connected cafe that merely lost
  // network gets told to reconnect from scratch (repo memory lesson).
  if (status.isPaused) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telegram bot</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            You appear to be offline. Telegram setup will load once the
            connection is back.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (status.isLoadingError || !status.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telegram bot</CardTitle>
        </CardHeader>
        <CardContent>
          <ErrorState
            title="Couldn't reach the server"
            description={
              (status.error as Error)?.message ||
              "Something went wrong while loading Telegram setup. Please try again."
            }
            onRetry={() => status.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  const data = status.data;

  if (data.state === "absent" || data.state === "unreadable") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Telegram bot</CardTitle>
          <CardDescription>
            Send Telegram alerts to staff when a diner places a QR order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.state === "unreadable" ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Re-paste your bot token</p>
              <p className="mt-1 text-amber-800">
                The server key changed, so the stored token can&apos;t be
                read. Paste the token again — connections are kept.
              </p>
            </div>
          ) : (
            <>
              {webhookMayRemain && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Disconnected, but the webhook may still be registered —
                  regenerate the token via BotFather /token to
                  force-invalidate.
                </div>
              )}
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Open @BotFather in Telegram and send <code>/newbot</code>
                </li>
                <li>Name your bot, then copy the token BotFather gives you</li>
                <li>Paste the token below and Save</li>
              </ol>
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="telegram-bot-token">Bot token</Label>
            <Input
              id="telegram-bot-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="123456:the-token-BotFather-gave-you"
              disabled={connect.isPending}
            />
          </div>

          <Button type="button" onClick={submitToken} disabled={connect.isPending || !token.trim()}>
            {connect.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </CardContent>
      </Card>
    );
  }

  // state "ok"
  const webhookMissing = !data.webhookUrl || data.live?.urlMatches === false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>@{data.botUsername ?? "Connected bot"}</CardTitle>
        <CardDescription>
          Connected — alerts fan out to the chats below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {webhookMissing && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <span>
              The webhook isn&apos;t pointed at this site — alerts may not
              arrive.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => repair.mutate()}
              disabled={repair.isPending}
            >
              {repair.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Repair webhook
            </Button>
          </div>
        )}

        {/* Telegram's own message about OUR endpoint — shown verbatim. */}
        {data.live?.lastErrorMessage && (
          <p className="text-xs text-muted-foreground">
            Telegram reports: &quot;{data.live.lastErrorMessage}&quot;
          </p>
        )}

        {data.liveError && (
          <p className="text-xs text-muted-foreground">
            Couldn&apos;t reach Telegram just now to check live webhook
            health.
          </p>
        )}

        {data.erroringChats > 0 && (
          <p className="text-xs text-destructive">
            {data.erroringChats} chat{data.erroringChats === 1 ? "" : "s"} had
            send errors in the last 24h
          </p>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <Badge variant="outline">
            {data.activeChats} active chat{data.activeChats === 1 ? "" : "s"}
          </Badge>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmingDisconnect(true)}
          >
            Disconnect
          </Button>
        </div>

        <TelegramChatsList botUsername={data.botUsername} />
      </CardContent>

      <ConfirmDialog
        open={confirmingDisconnect}
        onOpenChange={setConfirmingDisconnect}
        title="Disconnect this bot?"
        description="Chats are kept — reconnecting the same bot restores alerts. Connecting a DIFFERENT bot means every chat has to reconnect."
        confirmLabel="Disconnect"
        isLoading={disconnect.isPending}
        onConfirm={() =>
          disconnect.mutate(undefined, {
            onSuccess: (data) => {
              setWebhookMayRemain(!data.webhookDeleted);
              setConfirmingDisconnect(false);
            },
          })
        }
      />
    </Card>
  );
}
