"use client";

import * as React from "react";
import { Delete } from "lucide-react";

import { cn } from "@/lib/utils";
import { PIN_KEY_CLASS } from "@/lib/ui";
import { pinKeyFromKeyboard, pinPadNext, type PinKey } from "@/lib/pin-pad";

/**
 * Colour classes a staff screen passes in for the "reveal" size: this kit file names only the colour tokens the
 * diner preset sets (lib/kit-look-paths.test.ts), so the owner's HTML shades that have no preset twin come from the
 * caller.
 */
interface PinPadTones {
  /** An empty dot's ring (the HTML's --text-3). Default: the muted text colour. */
  dotEmpty?: string;
  /** The dots' fill after a wrong PIN (the HTML's --bad-t). Default: none. */
  dotErrorFill?: string;
  /** The message line's colour (the HTML's --bad-i). Default: destructive. */
  message?: string;
  /** Extra classes on every key (the press feel, the pressed fill). */
  key?: string;
}

interface PinPadProps {
  value: string;
  length?: number;
  onChange: (next: string) => void;
  /** Fires once when `onChange` brings the value to `length`; the parent clears `value` to start again. */
  onComplete: (pin: string) => void;
  error?: string | null;
  disabled?: boolean;
  /** Listen for digits / Backspace / Delete on the window (a PC); never while an input has focus. */
  keyboard?: boolean;
  /** "default": the sign-in and lock pad. "reveal": the dashboard's sales-reveal dialog (owner's HTML, values 3.16). */
  size?: "default" | "reveal";
  /** reveal: the line above the dots ("Asha, enter your PIN"). */
  prompt?: React.ReactNode;
  /** reveal: how many wrong answers so far; each one replays the dots' shake. */
  errorCount?: number;
  /** reveal: the caller's colour classes. */
  tones?: PinPadTones;
}

const DIGITS: PinKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50";
const keyClass = cn(
  PIN_KEY_CLASS,
  "rounded-lg border border-border bg-card text-xl font-medium text-foreground transition-colors hover:bg-muted active:bg-muted",
  FOCUS,
);
const quietKeyClass = cn(
  PIN_KEY_CLASS,
  "rounded-lg bg-transparent text-sm font-medium text-foreground transition-colors hover:bg-muted active:bg-muted",
  FOCUS,
);

// The reveal dialog's keys (values 3.16 keysFor): 50px tall, radius 14, 500 weight; digits 24px on the surface with
// the border, Clear 14px and ⌫ 20px on no fill and a transparent border; hover --hover (the preset's muted).
const REVEAL_KEY = "h-[50px] rounded-[14px] border font-medium leading-[normal] text-foreground hover:bg-muted";
const REVEAL_DIGIT = "border-border bg-card text-[24px]";
const REVEAL_QUIET = "border-transparent bg-transparent";

function PinPad({
  value,
  length = 4,
  onChange,
  onComplete,
  error,
  disabled = false,
  keyboard = false,
  size = "default",
  prompt,
  errorCount = 0,
  tones = {},
}: PinPadProps) {
  // Latest props for the window listener, so it is added once and never stale.
  const latest = React.useRef({ value, length, onChange, onComplete, disabled });
  latest.current = { value, length, onChange, onComplete, disabled };

  const press = React.useCallback((key: PinKey) => {
    const cur = latest.current;
    if (cur.disabled) return;
    const next = pinPadNext(cur.value, key, cur.length);
    if (next === cur.value) return;
    cur.onChange(next);
    if (next.length === cur.length) cur.onComplete(next);
  }, []);

  React.useEffect(() => {
    if (!keyboard) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (latest.current.disabled || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const key = pinKeyFromKeyboard(e.key);
      if (!key) return;
      e.preventDefault();
      press(key);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keyboard, press]);

  const live = (
    <p className="sr-only" aria-live="polite">
      {value.length} of {length} digits entered
    </p>
  );

  if (size === "reveal") {
    // values 3.16 dots(): 14px, a 1.5px ring 16px apart; typed = ink; after a wrong PIN with nothing typed the ring
    // turns bad and the dot takes the tint; the row shakes on every wrong answer (a new key re-mounts it).
    const failed = !!error && value.length === 0;
    const revealKey = (k: PinKey, label: string, quiet: boolean, extra?: string) => (
      <button
        key={k}
        type="button"
        data-ui="reveal-key"
        disabled={disabled}
        aria-label={k === "back" ? "Delete last digit" : undefined}
        className={cn(REVEAL_KEY, quiet ? REVEAL_QUIET : REVEAL_DIGIT, extra, FOCUS, tones.key)}
        onClick={() => press(k)}
      >
        {label}
      </button>
    );
    return (
      <div className="flex w-full flex-col gap-4">
        <div data-ui="reveal-pin" className="flex flex-col items-center gap-2.5">
          {prompt}
          <div
            key={errorCount}
            data-ui="reveal-dots"
            aria-hidden="true"
            className={cn("flex justify-center gap-4", errorCount > 0 && "motion-safe:animate-html-shake")}
          >
            {Array.from({ length }, (_, i) => (
              <span
                key={i}
                data-filled={i < value.length ? "true" : "false"}
                className={cn(
                  "size-3.5 rounded-[50%] border-[1.5px] transition-[background-color] duration-[120ms]",
                  i < value.length ? "border-foreground bg-foreground" : (tones.dotEmpty ?? "border-muted-foreground"),
                  failed && cn("border-destructive", tones.dotErrorFill),
                )}
              />
            ))}
          </div>
          {live}
          <p
            data-ui="reveal-message"
            role={error ? "alert" : undefined}
            className={cn("min-h-[18px] text-center text-[13px] font-medium", tones.message ?? "text-destructive")}
          >
            {error ?? null}
          </p>
        </div>
        <div data-ui="reveal-keys" className="grid grid-cols-3 gap-2">
          {DIGITS.map((d) => revealKey(d, d, false))}
          {revealKey("clear", "Clear", true, "text-[14px]")}
          {revealKey("0", "0", false)}
          {revealKey("back", "⌫", true, "text-[20px]")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[300px] flex-col items-center gap-5">
      <div className="flex items-center gap-4" aria-hidden="true">
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            data-filled={i < value.length ? "true" : "false"}
            className={cn(
              "h-3 w-3 rounded-full border border-foreground/50",
              i < value.length && "border-primary bg-primary",
              // A wrong PIN empties the pad and turns its dots red (the shake stays on the line); the next
              // try's digits fill in the usual colour while the error line stays above them.
              error && value.length === 0 && "border-destructive",
            )}
          />
        ))}
      </div>
      {live}
      <p
        key={error ?? "none"}
        role={error ? "alert" : undefined}
        className={cn("min-h-5 text-center text-sm text-destructive", error && "motion-safe:animate-brand-shake")}
      >
        {error ?? null}
      </p>
      <div className="grid w-full grid-cols-3 gap-2.5">
        {DIGITS.map((d) => (
          <button key={d} type="button" disabled={disabled} className={keyClass} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" disabled={disabled} className={quietKeyClass} onClick={() => press("clear")}>
          Clear
        </button>
        <button type="button" disabled={disabled} className={keyClass} onClick={() => press("0")}>
          0
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-label="Delete last digit"
          className={cn(quietKeyClass, "flex items-center justify-center")}
          onClick={() => press("back")}
        >
          <Delete className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export { PinPad };
export type { PinPadProps, PinPadTones };
