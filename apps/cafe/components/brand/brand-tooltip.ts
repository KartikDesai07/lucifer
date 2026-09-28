import { brandFontVariables } from "@/lib/brand-fonts";
import { cn } from "@/lib/utils";

/** Props for a stock shadcn tooltip (e.g. SidebarMenuButton's tooltip) in the
 *  brand ink. The tooltip is portaled out of whatever screen set the brand
 *  fonts, so it carries the font variables itself. */
export function brandTooltip(label: string) {
  return {
    children: label,
    className: cn(brandFontVariables, "bg-brand-ink font-brand-sans text-[13px] font-medium text-brand-slip"),
  };
}
