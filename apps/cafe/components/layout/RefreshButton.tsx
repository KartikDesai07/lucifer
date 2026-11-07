"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/header-classes";
import { useAskFirstReload } from "@/hooks/use-ask-first-reload";
import { inAppWebView } from "@/lib/printer/capabilities";
import { cn } from "@/lib/utils";

// The owner (2026-10-03): the POS app has no browser bar, so the page header carries Refresh among its buttons
// (U0 Task 3: the HTML's 36px outline square, before Tokens and the printer). A full reload, as a browser's
// refresh (sent orders live on the server; the print agent's pending acks survive it). It asks first when the page holds work a reload would lose (lib/page-refresh.ts), then
// tells the page's own leave warning the reload is deliberate, so no second, native question follows.
// Offline it says so instead of reloading into an error screen. That rule is hooks/use-ask-first-reload.ts, shared
// with the header's update chip (P2 N4). Shown only inside the POS app: read after mount, so the server's HTML and
// the first paint agree.
export function RefreshButton() {
  const [shown, setShown] = useState(false);
  const { reloading, press, dialog } = useAskFirstReload();
  useEffect(() => {
    setShown(inAppWebView());
  }, []);
  if (!shown) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className={HEADER_ICON_BUTTON_CLASS}
        aria-label="Refresh"
        title="Refresh"
        data-ui="header-refresh"
        disabled={reloading}
        onClick={press}
      >
        <RefreshCw className={cn(reloading && "animate-spin")} strokeWidth={1.8} aria-hidden="true" />
      </Button>
      <ConfirmDialog {...dialog} />
    </>
  );
}
