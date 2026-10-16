"use client";

import * as React from "react";
import { Delete } from "lucide-react";

import { cn } from "@/lib/utils";
import { PIN_KEY_CLASS } from "@/lib/ui";
import { pinKeyFromKeyboard, pinPadNext, type PinKey } from "@/lib/pin-pad";

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

function PinPad({ value, length = 4, onChange, onComplete, error, disabled = false, keyboard = false }: PinPadProps) {
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
              // A wrong PIN turns the dots red with the error line (the shake stays on the line).
              error && "border-destructive",
              error && i < value.length && "bg-destructive",
            )}
          />
        ))}
      </div>
      <p className="sr-only" aria-live="polite">
        {value.length} of {length} digits entered
      </p>
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
export type { PinPadProps };
