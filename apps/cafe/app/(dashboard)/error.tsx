"use client";

import { useEffect } from "react";
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
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleBuild = isChunkLoadError(error);

  useEffect(() => {
    if (!staleBuild) return;
    if (armChunkReload(chunkReloadStore(), Date.now())) window.location.reload();
  }, [staleBuild]);

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
      <div className="flex gap-2">
        {staleBuild ? (
          <Button onClick={() => window.location.reload()}>Reload</Button>
        ) : (
          <Button onClick={reset}>Try again</Button>
        )}
        <Button variant="outline" onClick={() => window.location.assign("/")}>
          Go to dashboard
        </Button>
      </div>
    </div>
  );
}
