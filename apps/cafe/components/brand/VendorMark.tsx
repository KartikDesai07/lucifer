import { VENDOR_PRODUCT_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";

// "Powered by Sandbee POS" — the software vendor's small mark (owner decision 2026-09-26), in the owner's HTML footer
// line (values 4.2): plain words in the footer's own 12.5px text-3, never competing with the cafe's own name and logo.
// The vendor name comes from the shared constant, never a literal here.
export function VendorMark({ className }: { className?: string }) {
  return (
    <span data-ui="vendor-mark" className={cn(className)}>
      {`Powered by ${VENDOR_PRODUCT_NAME}`}
    </span>
  );
}
