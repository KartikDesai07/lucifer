import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  description?: string;
  icon?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

// Shared "couldn't load" placeholder so a failed fetch never collapses into an
// empty state (which misleadingly reads as "no data"). CLAUDE.md §10 — every
// error shows what went wrong + what to do next.
export function ErrorState({
  title = "Couldn't load this",
  description = "Something went wrong while loading. Please try again.",
  icon = <AlertTriangle className="h-8 w-8" />,
  onRetry,
  retryLabel = "Retry",
  className,
}: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-destructive/40 p-8 text-center",
        className,
      )}
    >
      <div className="text-destructive">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
