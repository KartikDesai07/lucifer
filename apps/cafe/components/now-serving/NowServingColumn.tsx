import { cn } from "@/lib/utils";
import type { TokenBoardEntry } from "@/lib/token-view";

// Print customization S9 — one column of the Now Serving board (Preparing or Ready) and the number sizes it uses.
// The board sits beside the 16rem sidebar, so every size is clamp(rem floor, min(vw, vh), rem cap): the vw term keeps
// a long number inside a narrow column, the vh term keeps a few big numbers on one screen. No container queries, no
// viewport-width box: the shell owns the width. Every child is min-w-0 and a tile may break its own digits as a last
// resort, so nothing can push the page sideways.
const TOKEN_PREFIX = "Token "; // read before each number by a screen reader; the screen shows the bare number

export type NumberDensity = "lg" | "md" | "sm";

/** Size class and the most tiles shown (the rest read "+N more") for each density. */
export const DENSITY_STYLES: Record<NumberDensity, { sizeClass: string; visibleMax: number }> = {
  lg: { sizeClass: "text-[length:clamp(3rem,min(9vw,14vh),11rem)]", visibleMax: 4 },
  md: { sizeClass: "text-[length:clamp(2.25rem,min(6vw,9vh),6rem)]", visibleMax: 9 },
  sm: { sizeClass: "text-[length:clamp(1.5rem,min(4vw,5.5vh),4rem)]", visibleMax: 24 },
};

interface NowServingColumnProps {
  title: string;
  kind: "preparing" | "ready";
  entries: TokenBoardEntry[];
  density: NumberDensity;
  emptyText: string;
  className?: string;
}

export function NowServingColumn({ title, kind, entries, density, emptyText, className }: NowServingColumnProps) {
  const ready = kind === "ready";
  const headingId = `now-serving-${kind}`;
  const { sizeClass, visibleMax } = DENSITY_STYLES[density];
  const shown = entries.slice(0, visibleMax);
  const hidden = entries.length - shown.length;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 rounded-xl p-4 sm:p-6",
        ready ? "bg-brand-primary text-white" : "border border-brand-rule bg-brand-slip text-brand-muted",
        className,
      )}
    >
      <h2 id={headingId} className={cn("text-lg font-bold sm:text-xl", ready ? "text-white" : "text-brand-ink")}>
        {title}
      </h2>
      {entries.length === 0 ? (
        <p className="mt-3 text-base">{emptyText}</p>
      ) : (
        <ul className="mt-3 flex min-w-0 flex-wrap gap-x-6 gap-y-3">
          {shown.map((entry) => (
            <li key={entry.id} className="min-w-0 max-w-full">
              <span
                className={cn("block max-w-full break-all font-black leading-none tabular-nums", sizeClass)}
              >
                <span className="sr-only">{TOKEN_PREFIX}</span>
                {entry.number}
              </span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="min-w-0 self-center text-lg font-semibold">+{hidden} more</li>
          )}
        </ul>
      )}
    </section>
  );
}
