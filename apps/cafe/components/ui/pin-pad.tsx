"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { PIN_KEY_CLASS } from "@/lib/ui";
import { pinKeyFromKeyboard, pinPadNext, type PinKey } from "@/lib/pin-pad";

/**
 * Colour classes a staff screen passes in: this kit file names only the colour tokens the diner preset sets
 * (lib/kit-look-paths.test.ts), so the owner's HTML shades that have no preset twin come from the caller.
 */
interface PinPadTones {
  /** An empty dot's ring (the HTML's --text-3). Default: the muted text colour. */
  dotEmpty?: string;
  /** reveal: the dots' fill after a wrong PIN (the HTML's --bad-t). Default: none. */
  dotErrorFill?: string;
  /** default: the dots' ring and fill on a right PIN (the HTML's --ok). Default: primary. */
  dotSuccess?: string;
  /** The message line's colour for an error (the HTML's --bad-i). Default: destructive. */
  message?: string;
  /** default: the message line's colour on a right PIN (the HTML's --ok-i). Default: primary. */
  messageSuccess?: string;
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
  /** "default": the sign-in and lock pad (owner's HTML, values 4.4). "reveal": the dashboard's sales-reveal dialog
   *  (values 3.16). */
  size?: "default" | "reveal";
  /** reveal: the line above the dots ("Asha, enter your PIN"). */
  prompt?: React.ReactNode;
  /** How many wrong answers so far; each one replays the dots' shake. */
  errorCount?: number;
  /** The caller's colour classes. */
  tones?: PinPadTones;
  /** default: a right PIN's line ("Unlocking…"); the dots turn to the success colour while it shows. */
  successText?: string | null;
  /** default: the keypad at .35 (the HTML's look while a person is locked out). */
  dimmed?: boolean;
}

const DIGITS: PinKey[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none disabled:opacity-50";

// The sign-in pad's keys (values 4.4, the final keys of app.js 823): 60px tall (62 on a phone), radius 10, 500 weight,
// line-height normal; digits 22px on the surface with the border, Clear 13.5px and ⌫ 19px on no fill and a transparent
// border; hover --hover (the preset's muted). A disabled key keeps its strength: the HTML dims the whole keypad only
// while a person is locked out (`dimmed`), never for a try in flight.
const SIGN_IN_FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:pointer-events-none";
const SIGN_IN_KEY = cn(PIN_KEY_CLASS, "rounded-[10px] border font-medium text-foreground hover:bg-muted");
// After the size: tailwind-merge drops a leading-* that comes before a text-[size].
const SIGN_IN_LEADING = "leading-[normal]";
const SIGN_IN_DIGIT = "border-border bg-card text-[22px]";
const SIGN_IN_QUIET = "border-transparent bg-transparent";

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
  successText = null,
  dimmed = false,
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

  // values 4.4 lk.dotsEl: 13px dots, a 1.5px ring 16px apart; typed = ink, empty = the caller's text-3; after a wrong
  // PIN (the pad empties itself) a red ring with no fill, until the next PIN is typed; on a right PIN every dot takes
  // the success colour. The row shakes on every wrong answer (a new key re-mounts it).
  const succeeded = successText !== null && successText !== "";
  const failed = !succeeded && !!error && value.length === 0;
  const signInKey = (k: PinKey, label: string, quiet: boolean, extra?: string) => (
    <button
      key={k}
      type="button"
      data-ui="pin-key"
      disabled={disabled}
      aria-label={k === "back" ? "Delete last digit" : undefined}
      className={cn(SIGN_IN_KEY, quiet ? SIGN_IN_QUIET : SIGN_IN_DIGIT, extra, SIGN_IN_LEADING, SIGN_IN_FOCUS, tones.key)}
      onClick={() => press(k)}
    >
      {label}
    </button>
  );
  return (
    <div data-ui="pin-pad" className="mx-auto flex w-full max-w-[300px] flex-col items-center gap-[18px]">
      <div data-ui="pin-status" className="flex flex-col items-center gap-2.5">
        <div
          key={errorCount}
          data-ui="pin-dots"
          aria-hidden="true"
          className={cn("flex gap-4", errorCount > 0 && "motion-safe:animate-html-shake")}
        >
          {Array.from({ length }, (_, i) => (
            <span
              key={i}
              data-filled={i < value.length ? "true" : "false"}
              className={cn(
                "size-[13px] rounded-[50%] border-[1.5px] transition-[background-color,border-color] duration-150",
                i < value.length ? "border-foreground bg-foreground" : (tones.dotEmpty ?? "border-muted-foreground"),
                failed && "border-destructive",
                succeeded && (tones.dotSuccess ?? "border-primary bg-primary"),
              )}
            />
          ))}
        </div>
        {live}
        <p
          key={error ?? "none"}
          data-ui="pin-message"
          role={error ? "alert" : undefined}
          className={cn(
            "min-h-5 text-center text-[13px] font-medium",
            succeeded
              ? (tones.messageSuccess ?? "text-primary")
              : error
                ? (tones.message ?? "text-destructive")
                : "text-muted-foreground",
          )}
        >
          {succeeded ? successText : (error ?? null)}
        </p>
      </div>
      <div data-ui="pin-keys" className={cn("grid w-full grid-cols-3 gap-2.5", dimmed && "opacity-35")}>
        {DIGITS.map((d) => signInKey(d, d, false))}
        {signInKey("clear", "Clear", true, "text-[13.5px]")}
        {signInKey("0", "0", false)}
        {signInKey("back", "⌫", true, "text-[19px]")}
      </div>
    </div>
  );
}

export { PinPad };
export type { PinPadProps, PinPadTones };
