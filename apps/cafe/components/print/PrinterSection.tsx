import type { HTMLAttributes, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { BRAND_PANEL_CLASS } from "@/components/brand/brand-classes";
import { PRINTER_TILE_BRAND_CLASS, PRINTER_TILE_CLASS } from "@/components/print/printer-classes";
import { cn } from "@/lib/utils";

interface PrinterSectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}

// One card of the printer panel: an icon tile, a title and one optional line,
// a hairline, then the body. Prop-driven; the rest (id, data-*, tabIndex) passes
// straight to the <section> so the banner can still focus its targets.
export function PrinterSection({ icon: Icon, title, description, children, className, ...rest }: PrinterSectionProps) {
  return (
    <section className={cn(BRAND_PANEL_CLASS, "rounded-lg border", className)} {...rest}>
      <div className="flex items-center gap-3 border-b border-brand-rule p-4">
        <span aria-hidden="true" className={cn(PRINTER_TILE_CLASS, PRINTER_TILE_BRAND_CLASS)}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
          {description !== undefined && <p className="text-sm text-brand-muted">{description}</p>}
        </div>
      </div>
      <div className="space-y-3 p-4 text-sm">{children}</div>
    </section>
  );
}
