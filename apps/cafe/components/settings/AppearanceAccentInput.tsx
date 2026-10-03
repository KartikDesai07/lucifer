"use client";

import { useEffect, useId, useRef, useState } from "react";

import { accentProblemText, checkAccent } from "@pos/shared/appearance-contrast";
import type { PresetId } from "@pos/shared/appearance";
import { cn } from "@/lib/utils";
import { BRAND_FIELD_ERROR_CLASS, BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";

// CR2.4 S5 (A17) — a native <input type="color"> fires its "input" event on
// EVERY drag tick while the OS picker is open; committing each tick straight
// to react-hook-form would re-render the whole settings form (and the sibling
// AppearancePreview) on every pixel of drag. `live` local state absorbs that
// stream for the swatch + checkAccent feedback below; only the picker's
// "change" event — fired once, when the picker commits/closes — reaches the
// form via `onCommit`. React has no distinct onChange for this (it normalizes
// onChange to the native "input" event), so the commit listener is wired by
// hand through a ref.
interface AppearanceAccentInputProps {
  value: string; // "" = no override — the preset's own accent is shown
  presetAccent: string;
  presetId: PresetId;
  onCommit: (hex: string) => void;
}

export function AppearanceAccentInput({ value, presetAccent, presetId, onCommit }: AppearanceAccentInputProps) {
  const [live, setLive] = useState(value || presetAccent);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const statusId = useId();

  // The committed form value (or a preset switch changing the fallback) wins
  // over whatever the picker was mid-drag showing.
  useEffect(() => {
    setLive(value || presetAccent);
  }, [value, presetAccent]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const handleCommit = (e: Event) => onCommit((e.target as HTMLInputElement).value);
    el.addEventListener("change", handleCommit);
    return () => el.removeEventListener("change", handleCommit);
  }, [onCommit]);

  // Local-state feedback (A17): re-checked on every drag tick, never gating
  // anything — the Zod superRefine is the real gate, re-run at Save. Suppressed
  // ONLY in the untouched-default state (value==="" AND the picker still shows
  // the preset's own accent) — every preset's own accent fails checkAccent
  // against itself (see appearance-contrast.test.ts's own note), so without
  // this guard a fresh install would show a permanent, false destructive error
  // for a value that is neither stored nor validated. A plain `value === ""`
  // guard would ALSO suppress feedback mid-drag (the form value stays "" until
  // the picker's change event commits), so `live` must independently still
  // equal the preset accent for the suppression to apply.
  const untouchedDefault = value === "" && live === presetAccent;
  const feedback = untouchedDefault ? { ok: true as const } : checkAccent(live, presetId);

  // A fragment on purpose: the colour row is one item of the parent's flex-wrap
  // row, and the plain-English problem is a second item that order-last + w-full
  // drops onto its own line under that whole row (never the raw contrast pair).
  // The status stays mounted (sr-only while empty, so it takes no room) so a
  // screen reader hears the text appear, and the picker is described by it.
  // Never w-full while sr-only: w-full beats sr-only's 1px width and the
  // absolute box then pokes past the page edge (measured: 32px at 360).
  return (
    <>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          aria-describedby={statusId}
          type="color"
          value={live}
          onInput={(e) => setLive(e.currentTarget.value)}
          className="h-11 w-11 cursor-pointer rounded-md border p-0.5"
        />
        <label htmlFor={inputId} className={BRAND_LABEL_CLASS}>
          Pick your own colour
        </label>
      </div>
      <p
        id={statusId}
        role="status"
        className={cn(BRAND_FIELD_ERROR_CLASS, feedback.ok ? "sr-only" : "order-last w-full")}
      >
        {feedback.ok ? null : accentProblemText(feedback.reason)}
      </p>
    </>
  );
}
