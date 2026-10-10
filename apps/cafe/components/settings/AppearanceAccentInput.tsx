"use client";

import { useEffect, useId, useState } from "react";
import { Check } from "lucide-react";

import { accentProblemText, bestForeground, checkAccent } from "@pos/shared/appearance-contrast";
import type { PresetId } from "@pos/shared/appearance";
import { cn } from "@/lib/utils";
import { BRAND_BUTTON_CLASS, BRAND_FIELD_ERROR_CLASS, BRAND_INPUT_CLASS, BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ACCENT_SWATCHES, normalizeAccentHex } from "@/components/settings/accent-swatches";

// The popup's placement margin, so it never touches the edge of a 360px phone.
const POPOVER_COLLISION_PADDING = 8;
const HEX_ERROR_TEXT = "Use a # and six letters or numbers (0-9 and A-F), like #2563EB.";

// CR2.4 S5 (A17) history: the picker used to be the browser's own colour
// input, which fires on EVERY drag tick, so committing each tick to
// react-hook-form re-rendered the whole settings form (and the sibling
// AppearancePreview) on every pixel of drag. The owner banned that native
// popup (s89g), so the picker is now our own popover — and the rule is kept
// by construction: there is no drag stream. A colour reaches the form through
// `onCommit` exactly ONCE per pick — a swatch tap, or a valid hex applied with
// "Use this colour" / Enter. Typing in the hex field only edits a local draft.
// `live` is the candidate that drives the swatch and the checkAccent feedback.
interface AppearanceAccentInputProps {
  value: string; // "" = no override — the preset's own accent is shown
  presetAccent: string;
  presetId: PresetId;
  onCommit: (hex: string) => void;
}

export function AppearanceAccentInput({ value, presetAccent, presetId, onCommit }: AppearanceAccentInputProps) {
  const [live, setLive] = useState(value || presetAccent);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [hexInvalid, setHexInvalid] = useState(false);
  const inputId = useId();
  const statusId = useId();
  const swatchesId = useId();
  const hexId = useId();
  const hexErrorId = useId();

  // The committed form value (or a preset switch changing the fallback) wins
  // over whatever candidate was showing.
  useEffect(() => {
    setLive(value || presetAccent);
  }, [value, presetAccent]);

  // The one commit: show it, hand it to the form, close the popup.
  const pick = (hex: string) => {
    setLive(hex);
    onCommit(hex);
    setOpen(false);
  };

  // A bad hex is refused here, with a plain message — never committed, and the
  // error only appears when the owner applies, not on each keystroke.
  const applyDraft = () => {
    const hex = normalizeAccentHex(draft);
    if (hex === null) {
      setHexInvalid(true);
      return;
    }
    pick(hex);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(live);
      setHexInvalid(false);
    }
  };

  // Local-state feedback (A17): re-checked whenever the candidate changes, never gating
  // anything — the Zod superRefine is the real gate, re-run at Save. Suppressed
  // ONLY in the untouched-default state (value==="" AND the picker still shows
  // the preset's own accent) — every preset's own accent fails checkAccent
  // against itself (see appearance-contrast.test.ts's own note), so without
  // this guard a fresh install would show a permanent, false destructive error
  // for a value that is neither stored nor validated. A plain `value === ""`
  // guard would ALSO suppress feedback for a candidate that is not yet
  // committed, so `live` must independently still equal the preset accent for
  // the suppression to apply.
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
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger asChild>
            <button
              id={inputId}
              type="button"
              aria-describedby={statusId}
              style={{ backgroundColor: live }}
              className="h-11 w-11 shrink-0 cursor-pointer rounded-md border-2 border-brand-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2"
            />
          </PopoverTrigger>
          <PopoverContent align="start" collisionPadding={POPOVER_COLLISION_PADDING} className="max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-2rem))] space-y-3 overflow-y-auto overscroll-contain p-3">
            <p id={swatchesId} className={BRAND_LABEL_CLASS}>
              Pick a colour
            </p>
            <div role="group" aria-labelledby={swatchesId} className="grid grid-cols-4 gap-2">
              {ACCENT_SWATCHES.map(({ name, hex }) => {
                const selected = live === hex;
                return (
                  <button
                    key={hex}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => pick(hex)}
                    style={{ backgroundColor: hex, color: bestForeground(hex) }}
                    className={cn(
                      "relative flex h-11 w-full items-center justify-center rounded-md border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2",
                      selected ? "border-brand-ink" : "border-transparent",
                    )}
                  >
                    <span className="sr-only">{name}</span>
                    {selected && <Check className="h-5 w-5" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <div className="space-y-1.5 border-t border-brand-rule pt-3">
              <label htmlFor={hexId} className={BRAND_LABEL_CLASS}>
                Or type a colour code
              </label>
              <Input
                id={hexId}
                value={draft}
                placeholder="#2563EB"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={hexInvalid}
                aria-describedby={hexInvalid ? hexErrorId : undefined}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setHexInvalid(false);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  e.stopPropagation();
                  applyDraft();
                }}
                className={cn(BRAND_INPUT_CLASS, "h-11 uppercase placeholder:normal-case")}
              />
              {hexInvalid && (
                <p id={hexErrorId} role="alert" className={BRAND_FIELD_ERROR_CLASS}>
                  {HEX_ERROR_TEXT}
                </p>
              )}
              <Button type="button" className={cn(BRAND_BUTTON_CLASS, "h-11")} onClick={applyDraft}>
                Use this colour
              </Button>
            </div>
          </PopoverContent>
        </Popover>
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
