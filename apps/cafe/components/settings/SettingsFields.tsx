import { useId } from "react";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  BRAND_FIELD_ERROR_CLASS,
  BRAND_LABEL_CLASS,
  BRAND_PANEL_CLASS,
} from "@/components/brand/brand-classes";
import { cn } from "@/lib/utils";

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

// One two-column settings row: the group's name + one line on the left, its
// panel on the right. It stacks below lg because at md the sidebar leaves
// only ~464px. The title is an h3 — the page title (PageHeader) is the h2.
// `stacked` keeps the title above the panel at every width, for a page whose
// width is shared with something else (the Bill print page's sticky preview).
export function SettingsGroup({
  title,
  description,
  id,
  panelClassName,
  stacked = false,
  children,
}: {
  title: string;
  description: React.ReactNode;
  id?: string;
  panelClassName?: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "grid scroll-mt-20 gap-4 border-t border-brand-rule pt-6 first:border-t-0 first:pt-0",
        !stacked && "lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8",
      )}
    >
      <div className="space-y-1">
        <h3 id={headingId} className="text-[15px] font-semibold text-brand-ink">{title}</h3>
        <p className="text-sm text-brand-muted">{description}</p>
      </div>
      <div className={cn("min-w-0 space-y-4 rounded-lg border p-4 sm:p-5", BRAND_PANEL_CLASS, panelClassName)}>
        {children}
      </div>
    </section>
  );
}
