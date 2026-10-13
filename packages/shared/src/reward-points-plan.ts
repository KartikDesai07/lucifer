// CB-7 S6 (§2.7) — which lots a points spend takes from. PURE, client-safe. The server plans from a fresh read and
// guards the write per lot (the `spentBefore` it records), so a plan that went stale simply misses its CAS and is
// re-planned; the plan itself is never trusted.

import type { RewardCardSnapshot } from "./reward-levels";
import { cardStateAt } from "./reward-levels-engine";

export type PointsPlanCard = Pick<
  RewardCardSnapshot,
  "id" | "kind" | "status" | "value" | "pointsSpent" | "scratchBy" | "validUntil"
>;

// One lot's share of a spend. `spentBefore` + `value` are what the CAS guards on (and decides "lot now used up").
export interface PointsLotTake {
  id: string;
  take: number;
  spentBefore: number;
  value: number;
}

/**
 * Plan spending EXACTLY `n` whole points. Usable lots: kind "points" and revealed at `now` (cardStateAt's strict `>`,
 * so the use-by instant itself still counts). First in, first out by `validUntil`, ties by id; each lot gives
 * min(rest, value - pointsSpent). `null` when `n` is not a positive whole number or the lots are short — the caller
 * refuses, it never spends less than it was asked for.
 */
export function planPointsSpend(cards: readonly PointsPlanCard[], n: number, now: Date): PointsLotTake[] | null {
  if (!Number.isInteger(n) || n <= 0) return null;
  const usable = cards
    .filter((c) => c.kind === "points" && cardStateAt(c, now) === "revealed")
    .sort((a, b) => (a.validUntil?.getTime() ?? 0) - (b.validUntil?.getTime() ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const plan: PointsLotTake[] = [];
  let rest = n;
  for (const card of usable) {
    if (rest <= 0) break;
    const spentBefore = card.pointsSpent ?? 0;
    const take = Math.min(rest, card.value - spentBefore);
    if (take <= 0) continue;
    plan.push({ id: card.id, take, spentBefore, value: card.value });
    rest -= take;
  }
  return rest > 0 ? null : plan;
}
