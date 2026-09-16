/**
 * Deterministic RNG + IST day/time helpers for the demo seeder. Every planner
 * (orders-plan.ts, extras-plan.ts) draws exclusively from `ctx.rng` — nothing
 * here touches `Date.now()`/`Math.random()` — so a fixed seed reproduces the
 * exact same demo dataset byte-for-byte.
 *
 * (console.* is not used here — this module is pure.)
 */
import { cafeDateString } from "@/lib/utils";
import { CAFE_UTC_OFFSET_MINUTES } from "@/lib/constants";
import type { Rng } from "./types";

// mulberry32 — a small, fast, well-distributed 32-bit PRNG. Deterministic for
// a given seed; not cryptographic (fine — this is synthetic demo content).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const next = mulberry32(seed);
  return {
    next,
    int(min: number, max: number): number {
      return min + Math.floor(next() * (max - min + 1));
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error("rng.pick: empty array");
      return items[Math.floor(next() * items.length)];
    },
    weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
      const total = items.reduce((sum, item) => sum + Math.max(0, weightOf(item)), 0);
      if (total <= 0) throw new Error("rng.weighted: every weight is <= 0");
      let draw = next() * total;
      for (const item of items) {
        const w = Math.max(0, weightOf(item));
        if (draw < w) return item;
        draw -= w;
      }
      // Floating-point edge case (draw landed exactly on the running total) —
      // fall back to the last positively-weighted item rather than undefined.
      for (let i = items.length - 1; i >= 0; i--) {
        if (weightOf(items[i]) > 0) return items[i];
      }
      throw new Error("rng.weighted: every weight is <= 0");
    },
    chance(p: number): boolean {
      return next() < p;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

// ── IST day/time helpers ─────────────────────────────────────────────────────
const CAFE_OFFSET_MS = CAFE_UTC_OFFSET_MINUTES * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

// The UTC instant corresponding to a given cafe-local (IST) wall-clock time on
// `dayKey` ("YYYY-MM-DD"). Inverse of `cafeDateString`/`cafeHourOf`: adding the
// IST offset to a UTC instant gives the IST wall clock, so building the IST
// wall clock first and subtracting the offset gives back the UTC instant.
export function istInstant(dayKey: string, hour: number, minute: number, second = 0): Date {
  const [year, month, day] = dayKey.split("-").map(Number);
  const istWallUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  return new Date(istWallUtcMs - CAFE_OFFSET_MS);
}

// `count` cafe-local day keys ending on (and including) the IST day containing
// `now`, oldest first. dayKeysEndingToday(now, 31) → 30 days back + today.
export function dayKeysEndingToday(now: Date, count: number): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    days.push(cafeDateString(new Date(now.getTime() - i * ONE_DAY_MS)));
  }
  return days;
}

export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MS_PER_MINUTE);
}

// "YYYY-MM-DD" → "YYYYMMDD", matching @pos/shared/utils's generateOrderId.
export function dayKeyToCompact(dayKey: string): string {
  return dayKey.replace(/-/g, "");
}

// 0 = Sunday … 6 = Saturday, for the IST calendar day `dayKey` names (noon IST
// avoids any DST/offset edge at midnight — IST itself has none, but this keeps
// the calculation anchored safely inside the named day).
export function weekdayOf(dayKey: string): number {
  return istInstant(dayKey, 12, 0, 0).getUTCDay();
}
