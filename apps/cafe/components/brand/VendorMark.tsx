import { VENDOR_PRODUCT_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

// "Powered by Sandbee POS" — the software vendor's small mark (owner decision
// 2026-09-26). Deliberately quiet: muted text, one tiny terracotta dot, never
// competing with the cafe's own name and logo. The vendor name comes from the
// shared constant, never a literal here.
export function VendorMark({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-center gap-2 text-xs text-brand-muted", className)}>
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" />
      <span>
        Powered by <span className="font-semibold text-brand-ink">{VENDOR_PRODUCT_NAME}</span>
      </span>
    </p>
  );
}
