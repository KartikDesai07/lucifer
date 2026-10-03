"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PRINTER_ICON_BUTTON_CLASS } from "@/components/print/printer-classes";
import {
  REFRESH_CONFIRM_TITLE,
  REFRESH_OFFLINE_MESSAGE,
  REFRESH_SETTLE_MS,
  clearDeliberateReload,
  markDeliberateReload,
  refreshQuestion,
  unsentWork,
  type UnsentWork,
} from "@/lib/page-refresh";
import { inAppWebView } from "@/lib/printer/capabilities";
import { cn } from "@/lib/utils";

// The owner (2026-10-03): the POS app has no browser bar, so the top bar carries Refresh beside the printer
// icon. A full reload, as a browser's refresh (sent orders live on the server; the print agent's pending
// acks survive it). It asks first when the page holds work a reload would lose (lib/page-refresh.ts), then
// tells the page's own leave warning the reload is deliberate, so no second, native question follows.
// Offline it says so instead of reloading into an error screen. Shown only inside the POS app: read after
// mount, so the server's HTML and the first paint agree.
export function RefreshButton() {
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState<UnsentWork | null>(null);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    setShown(inAppWebView());
  }, []);
  if (!shown) return null;

  const reload = () => {
    setAsking(null);
    setReloading(true);
    markDeliberateReload();
    window.setTimeout(() => {
      clearDeliberateReload();
      setReloading(false);
    }, REFRESH_SETTLE_MS);
    window.location.reload();
  };
  const onPress = () => {
    if (navigator.onLine === false) {
      toast.error(REFRESH_OFFLINE_MESSAGE);
      return;
    }
    const work = unsentWork();
    if (work !== null) {
      setAsking(work);
      return;
    }
    reload();
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={PRINTER_ICON_BUTTON_CLASS}
        aria-label="Refresh"
        title="Refresh"
        disabled={reloading}
        onClick={onPress}
      >
        <RefreshCw className={cn(reloading && "animate-spin")} aria-hidden="true" />
      </Button>
      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={REFRESH_CONFIRM_TITLE}
        description={asking === null ? undefined : refreshQuestion(asking)}
        confirmLabel="Refresh"
        cancelLabel="Stay"
        onConfirm={reload}
      />
    </>
  );
}
