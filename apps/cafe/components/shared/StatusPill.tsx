import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { STATUS_CLASSES, type StatusKind } from "@/lib/ui";

export function StatusDot({ kind, className }: { kind: StatusKind; className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block h-2 w-2 shrink-0 rounded-full", STATUS_CLASSES[kind].dot, className)} />;
}

export function StatusPill({
  kind,
  children,
  dot = false,
  className,
}: {
  kind: StatusKind;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_CLASSES[kind].pill,
        className,
      )}
    >
      {dot && <StatusDot kind={kind} />}
      {children}
    </span>
  );
}
