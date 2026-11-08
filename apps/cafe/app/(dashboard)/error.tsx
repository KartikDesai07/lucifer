"use client";

import { useEffect, useRef, useState } from "react";
import { lineIsUp, reloadWhenOnline } from "@/lib/offline-reload";
import { leaveWhenPrintFree } from "@/lib/print-host-busy";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { armChunkReload, chunkReloadStore, isChunkLoadError } from "@/lib/chunk-reload";

// Route-segment error boundary for every dashboard page. Without it, a render
// throw in any page white-screens the whole panel (CLAUDE.md §10 — error-friendly,
// never a blank screen). Next.js renders this in place of the page's content,
// keeping the sidebar/header shell intact.
//
// A missing build chunk (the tab predates a deploy — lib/chunk-reload.ts) is
// the one error "Try again" can never fix: the page reloads itself once, and
// only if that did not help does the operator see this screen, with a Reload
// button instead of a retry that would fail the same way.
//
// This layout keeps the print agent and print host mounted, so every document load here goes through the print gate
// (leaveWhenPrintFree, R71): it never cuts a slip leased to this tab. The automatic reload also waits for the line.
// The two buttons pass no line condition (printing Phase 5 kept them working offline); while one waits for a slip the
// screen says so. Only one gate ever waits (the final review's F2): a tap first stops the automatic reload, else both
// would go in the same look once print is free (a reload racing assign("/")).
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleBuild = isChunkLoadError(error);
  const [waiting, setWaiting] = useState(false);
  const cancelLoad = useRef<() => void>(() => undefined);
  // The automatic reload's stop (its connection wait and its gate), where a button tap reaches it.
  const stopAuto = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!staleBuild) return;
    let cancelGate = () => {};
    // Printing Phase 5 (spec 5.10): a reload without the internet cannot open the page: it waits for the connection.
    // The loop guard is armed first; only an armed reload waits at the print gate (and for the line again).
    const stopWaiting = reloadWhenOnline(() => {
      if (!armChunkReload(chunkReloadStore(), Date.now())) return;
      cancelGate = leaveWhenPrintFree(() => window.location.reload(), { ready: () => lineIsUp() });
    });
    const stop = () => {
      stopWaiting();
      cancelGate();
    };
    stopAuto.current = stop;
    return stop;
  }, [staleBuild]);

  // A button's load: now when no slip is printing, otherwise the screen shows the wait. Gone with the screen.
  useEffect(() => () => cancelLoad.current(), []);
  const load = (go: () => void) => {
    stopAuto.current();
    cancelLoad.current();
    let went = false;
    cancelLoad.current = leaveWhenPrintFree(() => {
      went = true;
      go();
    });
    if (!went) setWaiting(true);
  };

  // Don't surface raw internal error text to users in production.
  const detail =
    process.env.NODE_ENV === "production" ? null : error.message;

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold">
          {staleBuild ? "The app was updated" : "Something went wrong"}
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          {staleBuild
            ? "A newer version of the app is available. Reload to continue."
            : "This page hit an unexpected error. You can retry, or head back to the dashboard."}
        </p>
        {detail && (
          <p className="max-w-md text-xs text-muted-foreground">{detail}</p>
        )}
        {error.digest && (
          <p className="text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        )}
      </div>
      {/* There, empty, from the first render (NavProgressView's StillOpening), so a screen reader hears the words. */}
      <p role="status" aria-live="polite" className={waiting ? "max-w-md text-sm text-muted-foreground" : "sr-only"}>
        {waiting ? "A slip is printing here. The page opens as soon as it is done." : ""}
      </p>
      <div className="flex gap-2">
        {staleBuild ? (
          <Button disabled={waiting} onClick={() => load(() => window.location.reload())}>
            Reload
          </Button>
        ) : (
          <Button onClick={reset}>Try again</Button>
        )}
        <Button variant="outline" disabled={waiting} onClick={() => load(() => window.location.assign("/"))}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
