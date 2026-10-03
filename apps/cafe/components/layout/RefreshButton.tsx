"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { PRINTER_ICON_BUTTON_CLASS } from "@/components/print/printer-classes";
import { REFRESH_CONFIRM_BODY, REFRESH_CONFIRM_TITLE, hasUnsentWork } from "@/lib/page-refresh";
import { inAppWebView } from "@/lib/printer/capabilities";
import { cn } from "@/lib/utils";

// The owner (2026-10-03): the POS app has no browser bar, so the top bar carries Refresh beside the printer
// icon. A full reload, as a browser's refresh (sent orders live on the server; the print agent's pending
// acks survive it). When the POS cart holds lines not sent yet, it asks first (lib/page-refresh.ts). Shown
// only inside the POS app: read after mount, so the server's HTML and the first paint agree.
export function RefreshButton() {
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState(false);
  const [reloading, setReloading] = useState(false);
  useEffect(() => {
    setShown(inAppWebView());
  }, []);
  if (!shown) return null;

  const reload = () => {
    setAsking(false);
    setReloading(true);
    window.location.reload();
  };
  const onPress = () => {
    if (hasUnsentWork()) {
      setAsking(true);
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
        open={asking}
        onOpenChange={setAsking}
        title={REFRESH_CONFIRM_TITLE}
        description={REFRESH_CONFIRM_BODY}
        confirmLabel="Refresh"
        cancelLabel="Keep the cart"
        onConfirm={reload}
      />
    </>
  );
}
