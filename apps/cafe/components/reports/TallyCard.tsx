import { inr, inrPaise, cn } from "@/lib/utils";
import { DashCard, type DashCardStatus } from "@/components/dashboard/DashCard";
import type { MoneyLineSign } from "@/lib/money-breakdown";

// "How it adds up" (R1's right-hand card): a list of signed money lines, then
// a computed identity check — Σparts === total → a green tick, else a red
// "these don't match" line. NEVER a hard-coded tick (memory: a boolean once
// hid a real mismatch) — the check is always computed from the numbers this
// card is itself given.

export interface TallyLine {
  label: string;
  amount: number;
  sign?: MoneyLineSign;
  /** "total" bolds + rules above it (the net-sales row); "sub"/"muted" read lighter. */
  tone?: "main" | "muted" | "total" | "sub";
}

export interface TallyCheck {
  label: string;
  parts: readonly number[];
  total: number;
}

interface TallyCardProps {
  title: string;
  period?: string;
  lines: readonly TallyLine[];
  check: TallyCheck;
  status: DashCardStatus;
  onRetry?: () => void;
  updating?: boolean;
  className?: string;
  /**
   * Lines to reserve while the figures load (the lines are [] until then), so the
   * card landing never shoves the page down — on a phone this card sits above
   * the tables and its growth alone read as CLS 0.12 on the GST page.
   */
  reserveLines?: number;
}

const LINE_ROW_PX = 28;
const CHECK_ROW_PX = 40;

const PAISE_PER_RUPEE = 100;

export function TallyCard({ title, period, lines, check, status, onRetry, updating, className, reserveLines = 0 }: TallyCardProps) {
  const sum = check.parts.reduce((a, b) => a + b, 0);
  // Fractional menu prices (Batch 2 items) make a float Σ noisy (e.g.
  // 99.990000000000009); compare at PAISE precision rather than `===` rupees.
  const diffPaise = Math.round(sum * PAISE_PER_RUPEE) - Math.round(check.total * PAISE_PER_RUPEE);
  const matches = diffPaise === 0;

  return (
    <DashCard
      className={className}
      title={title}
      period={period}
      status={status}
      onRetry={onRetry}
      updating={updating}
      bodyMinHeight={Math.max(lines.length, reserveLines) * LINE_ROW_PX + CHECK_ROW_PX}
    >
      <div className="flex flex-col">
        {lines.map((line) => (
          <div
            key={line.label}
            style={{ minHeight: LINE_ROW_PX }}
            className={cn(
              "flex items-center justify-between gap-3 text-[13.5px]",
              line.tone === "total" && "mt-1 border-t border-brand-rule pt-2 font-semibold text-brand-ink",
              line.tone === "muted" || line.tone === "sub" ? "text-brand-muted" : line.tone !== "total" && "text-brand-ink",
            )}
          >
            <span>{line.label}</span>
            <span className="tabular-nums">
              {line.sign ? `${line.sign} ${inr(Math.abs(line.amount))}` : inr(line.amount)}
            </span>
          </div>
        ))}
        <div
          style={{ minHeight: CHECK_ROW_PX }}
          className={cn(
            "mt-2 flex items-center rounded-md px-2.5 text-[12.5px] font-medium",
            matches ? "bg-brand-up/10 text-brand-up" : "bg-brand-danger/10 text-brand-danger",
          )}
        >
          {matches
            ? `✓ ${check.label}`
            : `These don't match by ${diffPaise % PAISE_PER_RUPEE === 0 ? inr(Math.abs(diffPaise) / PAISE_PER_RUPEE) : inrPaise(Math.abs(diffPaise))} — please report it`}
        </div>
      </div>
    </DashCard>
  );
}
