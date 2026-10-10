import { ErrorState } from "@/components/shared/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import type { TokenBoard, TokenBoardEntry } from "@/lib/token-view";
import { NowServingColumn, type NumberDensity } from "@/components/now-serving/NowServingColumn";

// Print customization S9 — the Now Serving board: presentational only (the page owns the data, the sound and the
// realtime nudge). States in order: nothing loaded (error or skeleton) -> tokens off -> nothing to show -> columns.
// Below sm the columns stack with Ready FIRST; from sm up Preparing sits left, narrower (2fr / 3fr).
const LG_MAX_TOKENS = 4;
const MD_MAX_TOKENS = 9;
const WIDE_DIGITS = 5; // a number this long goes one size down
const WIDEST_DIGITS = 7; // ...and this long takes the smallest size
const PREPARING_STEP_DOWN = 1; // Preparing is the narrower, quieter column: one size below Ready for the same count

const DENSITY_ORDER: readonly NumberDensity[] = ["lg", "md", "sm"];
const LAST_RANK = DENSITY_ORDER.length - 1;

const OFF_TEXT = "Tokens are off. An admin can turn them on in Settings → Tokens & numbering.";
const EMPTY_TEXT = "No tokens right now. New orders show here.";
const GRID_CLASS = "grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-[2fr_3fr] sm:gap-6";

/** How big a column's numbers are: fewer tokens = bigger; long numbers step down so they stay inside the column. */
export function densityOf(count: number, maxDigits: number, stepDown = 0): NumberDensity {
  let rank = count <= LG_MAX_TOKENS ? 0 : count <= MD_MAX_TOKENS ? 1 : LAST_RANK;
  if (maxDigits >= WIDEST_DIGITS) rank = LAST_RANK;
  else if (maxDigits >= WIDE_DIGITS) rank += 1;
  return DENSITY_ORDER[Math.min(rank + stepDown, LAST_RANK)] ?? "sm";
}

function maxDigitsOf(entries: readonly TokenBoardEntry[]): number {
  return entries.reduce((most, e) => Math.max(most, String(e.number).length), 0);
}

interface NowServingBoardProps {
  board: TokenBoard | undefined;
  isError: boolean;
  onRetry: () => void;
}

function Notice({ children }: { children: string }) {
  return (
    <div className="rounded-xl border border-brand-rule bg-brand-slip p-6 text-base text-brand-muted sm:p-10 sm:text-lg">
      {children}
    </div>
  );
}

export function NowServingBoard({ board, isError, onRetry }: NowServingBoardProps) {
  if (!board) {
    if (isError) {
      return (
        <ErrorState
          title="Could not load the tokens"
          description="Check the internet connection, then try again."
          onRetry={onRetry}
          retryLabel="Try again"
        />
      );
    }
    return (
      <div className={GRID_CLASS} aria-busy="true">
        <Skeleton className="order-2 h-48 rounded-xl sm:order-1" />
        <Skeleton className="order-1 h-48 rounded-xl sm:order-2" />
      </div>
    );
  }
  if (!board.enabled) return <Notice>{OFF_TEXT}</Notice>;
  if (board.preparing.length === 0 && board.ready.length === 0) return <Notice>{EMPTY_TEXT}</Notice>;
  return (
    <div className={GRID_CLASS}>
      <NowServingColumn
        title="Preparing"
        kind="preparing"
        entries={board.preparing}
        density={densityOf(board.preparing.length, maxDigitsOf(board.preparing), PREPARING_STEP_DOWN)}
        emptyText="Nothing being prepared"
        className="order-2 sm:order-1"
      />
      <NowServingColumn
        title="Ready"
        kind="ready"
        entries={board.ready}
        density={densityOf(board.ready.length, maxDigitsOf(board.ready))}
        emptyText="Nothing ready yet"
        className="order-1 sm:order-2"
      />
    </div>
  );
}
