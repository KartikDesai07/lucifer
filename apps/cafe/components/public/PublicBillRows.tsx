import { inr } from "@/lib/utils";

// S3 — the pure, read-only ROW/TOTALS rendering split out of
// PublicCartBill.tsx (which is actually a pre-submit FORM: kitchen note,
// identity, honeypot — none of which a PAST order's bill can reuse). This
// piece owns nothing but presentation: no state, no fetch, no money math, no
// form controls. Both the live cart (via billFromCart) and a past order's
// status page (via billFromStatusData, public-bill-rows.ts) build the same
// { lines, totals } shape and hand it here, so the two surfaces render one
// identical bill look.

export interface PublicBillLine {
  label: string;
  sub?: string;
  qty: number;
  amount: number;
}

export interface PublicBillTotal {
  label: string;
  amount: number;
  strong?: boolean;
}

interface PublicBillRowsProps {
  lines: PublicBillLine[];
  totals: PublicBillTotal[];
}

export function PublicBillRows({ lines, totals }: PublicBillRowsProps) {
  return (
    <div className="space-y-pub-gap p-pub-pad">
      <div className="space-y-2">
        {lines.map((line, index) => (
          // Lines carry no stable id of their own (a past order's items and a
          // live cart's lines have different identity shapes) — index is safe
          // here because this list is never reordered/edited in place, only
          // ever rendered whole from a fresh { lines, totals } each time.
          <div key={index} className="flex items-start justify-between text-sm">
            <div>
              <div className="font-medium">
                {line.label} <span className="text-muted-foreground">× {line.qty}</span>
              </div>
              {line.sub && <div className="text-xs text-muted-foreground">{line.sub}</div>}
            </div>
            <span className="tabular-nums">{inr(line.amount)}</span>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        {totals.map((total) => (
          <div
            key={total.label}
            className={
              total.strong
                ? "flex items-center justify-between text-base font-semibold"
                : "flex items-center justify-between text-sm text-muted-foreground"
            }
          >
            <span>{total.label}</span>
            <span className="tabular-nums">{inr(total.amount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
