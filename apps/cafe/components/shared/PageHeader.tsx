import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  eyebrow?: string; // small muted line above the title, e.g. the section ("Menu")
  description?: string;
  actions?: ReactNode;
  className?: string;
}

// Measured page-header idiom (CB-UI1 audit), reused across every dashboard
// page: a bold h2 + optional muted one-line description on the left, any
// controls (buttons, badges, counts) on the right via `actions`. No hooks —
// usable from server components too. `flex-wrap`: on a narrow phone the
// actions drop below the title instead of pushing past the viewport (measured
// on the Menu Items page at 360px: two header buttons overflowed by 27px).
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="text-xs text-muted-foreground">{eyebrow}</p>}
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
