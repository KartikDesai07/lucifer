"use client";

import { useEffect, useState } from "react";

interface MenuNumberBoxProps {
  value: number;
  onChange: (value: number) => void;
  className: string;
  placeholder?: string;
  "aria-label": string;
  "aria-invalid"?: boolean;
  max?: number;
}

// A number input over a numeric model with today's rules (a plain type=number, `valueAsNumber || 0`, decimals allowed): it
// keeps what is typed as text, so a half-typed "1." or an emptied box is never rewritten under the cursor, and shows a
// zero as an empty box with the "0" placeholder (the HTML's). It follows the model when the model changes from outside.
export function MenuNumberBox({ value, onChange, className, placeholder = "0", max, ...aria }: MenuNumberBoxProps) {
  const shown = (n: number): string => (n === 0 ? "" : String(n));
  const [text, setText] = useState(shown(value));
  useEffect(() => {
    if ((Number(text) || 0) !== value) setText(shown(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={max}
      value={text}
      placeholder={placeholder}
      className={className}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.valueAsNumber || 0);
      }}
      {...aria}
    />
  );
}
