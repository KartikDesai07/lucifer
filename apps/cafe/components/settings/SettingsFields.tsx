import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BRAND_FIELD_ERROR_CLASS, BRAND_LABEL_CLASS } from "@/components/brand/brand-classes";

// htmlFor (optional): the id of the input inside, so a tap on the label
// focuses it and a screen reader names the input by it.
export function Field({
  label,
  error,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className={BRAND_LABEL_CLASS}>{label}</Label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && <p className={BRAND_FIELD_ERROR_CLASS}>{error}</p>}
    </div>
  );
}

// The whole row is the <label>: a tap anywhere on it flips the switch (the
// stock switch alone is a 20px target), and the switch is named by the title
// and described by the description.
export function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      className={`flex min-h-10 items-center justify-between gap-4 ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span className="space-y-0.5">
        <span id={`${id}-label`} className={`block ${BRAND_LABEL_CLASS}`}>{label}</span>
        <span id={`${id}-hint`} className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
      />
    </label>
  );
}
