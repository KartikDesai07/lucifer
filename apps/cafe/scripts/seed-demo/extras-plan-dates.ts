/**
 * Tiny date-arithmetic helpers shared by extras-plan.ts and
 * extras-plan-events.ts — kept separate so neither file has to import from
 * the other just for these two one-liners.
 */

// `today` ("YYYY-MM-DD") shifted by `deltaDays` (may be negative), calendar
// arithmetic done in UTC so it never drifts across a DST-less IST day.
export function dayKeyPlusDays(today: string, deltaDays: number): string {
  const [y, m, d] = today.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  const shifted = new Date(base + deltaDays * 24 * 60 * 60 * 1000);
  const yy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
