"use client";

import { useEffect, useState } from "react";
import { cafeDateString } from "@/lib/utils";
import {
  DASHBOARD_PRESETS,
  presetRange,
  rangeDays,
  type DashboardPreset,
} from "@/lib/dashboard/range";
import type { DashboardRange } from "@/types/dashboard";
import type { DashboardSelection } from "@/components/dashboard/RangeBar";

// The Dashboard's "remember the chosen period" logic, extracted so the
// Reports screens can reuse it under their own storage key / default preset /
// range cap (Batch 1 plan). Per-viewer convenience only (the period picked on
// this tab); never state that matters — a blocked or empty storage just means
// the caller's fallback preset.

export interface StoredPeriod {
  preset: DashboardPreset;
  custom?: DashboardRange;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

interface UseStoredPeriodOptions {
  /** sessionStorage key — MUST be unique per screen (Dashboard vs Reports). */
  key: string;
  /** The preset shown before the stored choice is restored, and if storage is empty/invalid. */
  fallback: DashboardPreset;
  /** Widest custom range this screen's server route will accept. */
  maxDays: number;
}

export interface UseStoredPeriodResult {
  period: StoredPeriod;
  /** Flips true after the one post-mount tick that reads sessionStorage — the
   *  caller should hold its query `enabled` on this so a remembered non-default
   *  period never first fetches the fallback and flashes. */
  restored: boolean;
  save: (next: StoredPeriod) => void;
}

/** The range a stored period resolves to right now (a fixed preset moves with the clock). */
export function rangeOfPeriod(period: StoredPeriod, fallback: DashboardPreset): DashboardRange {
  if (period.preset === "custom") return period.custom ?? presetRange(fallback === "custom" ? "today" : fallback);
  return presetRange(period.preset);
}

export function useStoredPeriod({ key, fallback, maxDays }: UseStoredPeriodOptions): UseStoredPeriodResult {
  const [period, setPeriod] = useState<StoredPeriod>({ preset: fallback });
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const stored = readStoredPeriod(key, maxDays);
    if (stored) setPeriod(stored);
    setRestored(true);
    // Deliberately re-runs only if the storage key itself changes (Dashboard
    // and Reports mount their own hook instance) — never on `fallback`/`maxDays`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const save = (next: StoredPeriod) => {
    setPeriod(next);
    writeStoredPeriod(key, next);
  };

  return { period, restored, save };
}

function readStoredPeriod(key: string, maxDays: number): StoredPeriod | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredPeriod>;
    if (!v.preset || !(DASHBOARD_PRESETS as readonly string[]).includes(v.preset)) return null;
    const c = v.custom;
    const custom =
      // Re-checked on read: a range the server would refuse (ends after today,
      // wider than the cap) must never pin the page to an error card.
      c &&
      typeof c.from === "string" &&
      typeof c.to === "string" &&
      DAY_KEY.test(c.from) &&
      DAY_KEY.test(c.to) &&
      c.from <= c.to &&
      c.to <= cafeDateString() &&
      rangeDays({ from: c.from, to: c.to }) <= maxDays
        ? { from: c.from, to: c.to }
        : undefined;
    return { preset: v.preset, custom };
  } catch {
    return null;
  }
}

function writeStoredPeriod(key: string, p: StoredPeriod): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(p));
  } catch {
    // Storage blocked (private mode, a preview) — the choice just isn't remembered.
  }
}

export type { DashboardSelection };
