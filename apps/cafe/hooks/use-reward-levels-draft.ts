"use client";

import { useMemo, useState } from "react";

import type { RewardLevelsConfig } from "@pos/shared/reward-levels";
import type { SectionFormExtra } from "@/hooks/use-settings-section-form";
import { emptyConfig } from "@/lib/reward-levels-edit";
import {
  positionShiftWarning,
  problemSentence,
  rewardDraftDirty,
  rewardLevelsProblems,
  seedRewardLevels,
  writeBodyOf,
  type RewardDraftBase,
  type RewardProblem,
} from "@/lib/reward-levels-form";
import type { Settings } from "@/types";

// The scratch-card editor's unsaved draft (CB-7 S3). Like hooks/use-slip-design-draft.ts it lives ABOVE the settings
// form, so the page hands the form a SectionFormExtra and keeps ONE Save bar, ONE dirty flag and ONE PUT. The draft
// is only ever a copy: nothing here writes anything until Save sends `extra.body()`. Opening a box never creates a
// draft — only a commit (`edit` / `replace`) does, so looking at the editor can never light up the Save bar.

interface DraftState {
  base: RewardDraftBase;
  /** The working copy; null = no setup (never started, or cleared by Start over). Meaningful once `touched`. */
  working: RewardLevelsConfig | null;
  /** Something was committed (a box, a size, a starter, Start over). Before that, the editor shows the baseline. */
  touched: boolean;
}

function seed(settings: Settings): DraftState {
  const base = seedRewardLevels(settings.rewardLevels);
  return { base, working: base.baseline, touched: false };
}

export interface RewardLevelsDraft {
  /** The parsed stored setup (null: none, or unreadable). */
  baseline: RewardLevelsConfig | null;
  /** The stored setup cannot be read and nothing has been chosen over it yet. */
  unreadable: boolean;
  /** The working copy once anything was committed, else null. */
  draft: RewardLevelsConfig | null;
  /** What the editor shows: the draft once committed, else the baseline (null after Start over). */
  current: RewardLevelsConfig | null;
  dirty: boolean;
  problems: RewardProblem[];
  positionWarning: string | null;
  /** Nothing to edit yet: the starters are offered. */
  nothingSetUp: boolean;
  /** Starters and Start over (null clears the setup: the server removes the stored one on Save). */
  replace: (next: RewardLevelsConfig | null) => void;
  /** Applies `fn` to the current setup, starting an empty one (seeded with the page's minimum bill) when there is none. */
  edit: (fn: (cfg: RewardLevelsConfig) => RewardLevelsConfig, seedMinBill?: number) => void;
  extra: SectionFormExtra;
}

export function useRewardLevelsDraft(settings: Settings): RewardLevelsDraft {
  const [state, setState] = useState<DraftState>(() => seed(settings));
  const { base, working, touched } = state;

  const current = touched ? working : base.baseline;
  const problems = useMemo(() => rewardLevelsProblems(current), [current]);
  const dirty = rewardDraftDirty(base, working, touched);
  const unreadable = base.unreadable && !touched;

  const replace = (next: RewardLevelsConfig | null) => setState((s) => ({ ...s, working: next, touched: true }));
  const edit = (fn: (cfg: RewardLevelsConfig) => RewardLevelsConfig, seedMinBill?: number) =>
    setState((s) => {
      const from = s.touched ? s.working : s.base.baseline;
      return { ...s, working: fn(from ?? emptyConfig(seedMinBill)), touched: true };
    });

  const extra: SectionFormExtra = {
    dirty,
    problem: () => {
      const first = problems[0];
      return first === undefined ? null : problemSentence(first);
    },
    body: () => ({ rewardLevels: writeBodyOf(current) }),
    discard: () => setState(seed(settings)),
    saved: (doc) => setState(seed(doc)),
  };

  return {
    baseline: base.baseline,
    unreadable,
    draft: touched ? working : null,
    current,
    dirty,
    problems,
    positionWarning: positionShiftWarning(base.baseline, current),
    nothingSetUp: current === null && !unreadable,
    replace,
    edit,
    extra,
  };
}
