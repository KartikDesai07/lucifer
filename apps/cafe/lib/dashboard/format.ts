// Dashboard number formatting — pure, client-safe. Full amounts go through
// the shared inr() (₹ with Indian grouping, no paise); these are the compact
// forms for chart axes and the delta wording on KPI cards.

const THOUSAND = 1_000;
const LAKH = 100_000;
const CRORE = 10_000_000;
const PERCENT = 100;
const ONE_DECIMAL_BELOW_PERCENT = 10; // "6.2%" but "18%"
const FLAT_BELOW_PERCENT = 0.05; // rounds to 0.0% — call it no change

function trim(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/\.0+$/, "");
}

/** Axis ticks in Indian units: ₹950 · ₹1.5k · ₹12k · ₹1.2L · ₹3.4Cr. */
export function inrCompact(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const a = Math.abs(amount);
  if (a >= CRORE) return `${sign}₹${trim(a / CRORE, 1)}Cr`;
  if (a >= LAKH) return `${sign}₹${trim(a / LAKH, 1)}L`;
  if (a >= THOUSAND) return `${sign}₹${trim(a / THOUSAND, a < 10 * THOUSAND ? 1 : 0)}k`;
  return `${sign}₹${Math.round(a)}`;
}

export type DeltaDirection = "up" | "down" | "flat";

/** A KPI change as words: { text: "6.2%", direction: "up" }; null when there is nothing to compare with. */
export function formatDelta(ratio: number | null): { text: string; direction: DeltaDirection } | null {
  if (ratio === null || !Number.isFinite(ratio)) return null;
  const pct = ratio * PERCENT;
  const abs = Math.abs(pct);
  if (abs < FLAT_BELOW_PERCENT) return { text: "0%", direction: "flat" };
  return { text: `${trim(abs, abs < ONE_DECIMAL_BELOW_PERCENT ? 1 : 0)}%`, direction: pct > 0 ? "up" : "down" };
}

/** "1 order" / "3 orders". */
export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}

/** A share as a whole percent, never "0%" for a real non-zero slice. */
export function sharePercent(share: number): string {
  const pct = share * PERCENT;
  if (pct > 0 && pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}
