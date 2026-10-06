"use client";

import { useMemo, useState } from "react";

import type { SectionFormExtra } from "@/hooks/use-settings-section-form";
import {
  activate as startDesign,
  baselineOf,
  draftDirty,
  lockContextOf,
  lockReasonOf,
  writeProblems,
  type DraftBase,
  type EditableTemplate,
  type LockReason,
  type WriteProblem,
} from "@/lib/print-design-editor";
import type { EditorKind } from "@/lib/print-design-kinds";
import { turnedOnNotice } from "@/lib/print-design-labels";
import type { Settings } from "@/types";

// A slip design editor's unsaved draft (print customization S4 bill, S5 kitchen ticket, S7 token slip; 04-S4-plan D2), generic
// over the slip kind. It lives ABOVE the settings form, so the page can hand the form a SectionFormExtra and keep
// ONE Save bar, ONE dirty flag and ONE PUT. The draft is only ever a copy: nothing here writes anything until Save
// sends `extra.body()`.

interface DraftState<T extends EditableTemplate> {
  base: DraftBase<T>;
  /** null = today's slip (no template). */
  draft: T | null;
  /** A choice was made over an unreadable stored design (the only case where `touched` decides dirty). */
  touched: boolean;
  notices: string[];
}

function seed<T extends EditableTemplate>(kind: EditorKind<T>, settings: Settings): DraftState<T> {
  const base = baselineOf(kind.spec, settings);
  return { base, draft: base.baseline, touched: false, notices: [] };
}

// One sentence per reason, naming only the lines the design had to switch on (the §2.7 notice).
function noticesOf<T extends EditableTemplate>(kind: EditorKind<T>, turnedOn: readonly string[], settings: Settings): string[] {
  const ctx = lockContextOf(settings);
  const byReason = new Map<LockReason, string[]>();
  for (const type of turnedOn) {
    const reason = lockReasonOf(kind.spec, type, ctx);
    if (reason === null) continue;
    const labels = byReason.get(reason) ?? [];
    labels.push(kind.blockLabel(type));
    byReason.set(reason, labels);
  }
  return [...byReason].map(([reason, labels]) => turnedOnNotice(labels, reason));
}

export interface SlipDesignDraft<T extends EditableTemplate> {
  /** The saved design as the draft started (null: none, or unreadable). */
  baseline: T | null;
  draft: T | null;
  /** A design is being edited (the draft is not "today's slip"). */
  active: boolean;
  dirty: boolean;
  /** The stored design cannot be read and nothing has been chosen over it yet. */
  unreadable: boolean;
  /** Plain sentences about lines a design had to switch on. */
  notices: string[];
  issues: WriteProblem[];
  set: (next: T) => void;
  /** Starts `design` from `legacy` (Classic follows its toggles; the others ignore them). */
  activate: (design: T["design"], legacy: Settings) => void;
  backToToday: () => void;
  /** Unreadable recovery 1: start Classic from today's settings. */
  recoverClassic: (legacy: Settings) => void;
  /** Unreadable recovery 2: keep today's slip and drop the unreadable design on Save. */
  keepToday: () => void;
  extra: SectionFormExtra;
}

export function useSlipDesignDraft<T extends EditableTemplate>(kind: EditorKind<T>, settings: Settings): SlipDesignDraft<T> {
  const [state, setState] = useState<DraftState<T>>(() => seed(kind, settings));
  const { base, draft, touched, notices } = state;

  const issues = useMemo(() => (draft === null ? [] : writeProblems(kind.spec, draft)), [kind, draft]);
  const dirty = draftDirty(base, draft, touched);

  const set = (next: T) => setState((s) => ({ ...s, draft: next, touched: true }));
  const activate = (design: T["design"], legacy: Settings) => {
    const started = startDesign(kind.spec, design, legacy);
    setState((s) => ({
      ...s,
      draft: started.template,
      touched: true,
      notices: noticesOf(kind, started.turnedOn, legacy),
    }));
  };
  const backToToday = () => setState((s) => ({ ...s, draft: null, touched: true, notices: [] }));

  const extra: SectionFormExtra = {
    dirty,
    problem: () => {
      const first = issues[0];
      if (draft === null || first === undefined) return null;
      const row = draft.blocks.find((block) => block.id === first.blockId);
      return row ? `${kind.blockLabel(row.type)}: ${first.message}` : first.message;
    },
    body: () => kind.bodyOf(draft),
    discard: () => setState(seed(kind, settings)),
    saved: (doc) => setState(seed(kind, doc)),
  };

  return {
    baseline: base.baseline,
    draft,
    active: draft !== null,
    dirty,
    unreadable: base.unreadable && !touched,
    notices,
    issues,
    set,
    activate,
    backToToday,
    // Recovery starts from the design printed today (Classic for the bill and the ticket, Big number for the token slip).
    recoverClassic: (legacy) => activate(kind.todayDesign, legacy),
    keepToday: backToToday,
    extra,
  };
}
