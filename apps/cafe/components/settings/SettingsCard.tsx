"use client";

import { useId } from "react";
import type { ReactNode } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MenuSwitch } from "@/components/menu/MenuSwitch";
import { cn } from "@/lib/utils";
import {
  SETTINGS_BLOCK_CLASS,
  SETTINGS_BLOCK_SUB_CLASS,
  SETTINGS_BLOCK_TITLE_CLASS,
  SETTINGS_CARD_BODY_CLASS,
  SETTINGS_CARD_CLASS,
  SETTINGS_CARD_HEAD_CLASS,
  SETTINGS_CARD_SUB_CLASS,
  SETTINGS_CARD_TITLE_CLASS,
  SETTINGS_CHIP_OFF_CLASS,
  SETTINGS_CHIP_ON_CLASS,
  SETTINGS_CHOICE_CLASS,
  SETTINGS_ERROR_CLASS,
  SETTINGS_FIELD_CLASS,
  SETTINGS_HINT_CLASS,
  SETTINGS_LABEL_CLASS,
  SETTINGS_SELECT_TRIGGER_CLASS,
  SETTINGS_SWITCH_ROW_CLASS,
} from "@/lib/settings-card-layout";

// The settings pages' card pieces (Business details first, 2026-11-06). Class strings live in
// lib/settings-card-layout.ts. Used by the pages already in the new look (Business details, GST & taxes, QR ordering).

// A card: the title (an h2, the shell's header holds the h1) and one line under it, the body below. `sub` is a node so a
// card can carry a link; `bodyClassName` replaces the body's look (the Bill preview sits on --surface-2).
export function SettingsCard({
  id,
  title,
  sub,
  className,
  bodyClassName,
  children,
}: {
  id?: string;
  title: string;
  sub: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={cn(SETTINGS_CARD_CLASS, className)}>
      <div className={SETTINGS_CARD_HEAD_CLASS}>
        <h2 id={headingId} className={SETTINGS_CARD_TITLE_CLASS}>
          {title}
        </h2>
        <p className={SETTINGS_CARD_SUB_CLASS}>{sub}</p>
      </div>
      <div className={bodyClassName ?? SETTINGS_CARD_BODY_CLASS}>{children}</div>
    </section>
  );
}

// A part of a card body (an h3), ruled off from the one above. `id` is a link target.
export function SettingsBlock({
  id,
  title,
  sub,
  children,
}: {
  id?: string;
  title: string;
  sub?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={SETTINGS_BLOCK_CLASS}>
      <div>
        <h3 id={headingId} className={SETTINGS_BLOCK_TITLE_CLASS}>
          {title}
        </h3>
        {sub && <p className={SETTINGS_BLOCK_SUB_CLASS}>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

// htmlFor names the control inside, so a tap on the label focuses it. The hint shows only while there is no error.
export function CardField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={SETTINGS_FIELD_CLASS}>
      <label htmlFor={htmlFor} className={SETTINGS_LABEL_CLASS}>
        {label}
      </label>
      {children}
      {hint && !error && <p className={SETTINGS_HINT_CLASS}>{hint}</p>}
      {error && <p className={SETTINGS_ERROR_CLASS}>{error}</p>}
    </div>
  );
}

export interface SettingsSelectOption {
  value: string;
  label: string;
}

// The kit Select (never a native select) in the settings look. `id` goes on the trigger so a label's htmlFor names it.
export function SettingsSelect({
  id,
  value,
  onValueChange,
  options,
  className,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SettingsSelectOption[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={cn(SETTINGS_SELECT_TRIGGER_CLASS, className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// A one-of-a-few choice (Percent off / Amount off) instead of a drop-down: each option is a <label> around a visually
// hidden native radio, so arrow keys and screen readers work as for any radio group. The legend reads as a field label.
export function SettingsChoice<T extends string>({
  legend,
  options,
  value,
  onChange,
  labelOf,
}: {
  legend: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelOf: (value: T) => string;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0">
      <legend className={cn(SETTINGS_LABEL_CLASS, "mb-1.5")}>{legend}</legend>
      <div className="flex gap-2">
        {options.map((option) => (
          <label
            key={option}
            className={cn(SETTINGS_CHOICE_CLASS, value === option ? SETTINGS_CHIP_ON_CLASS : SETTINGS_CHIP_OFF_CLASS)}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {labelOf(option)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

// An on/off row: the whole row is the label (a tap anywhere flips it; the switch alone is a small target). The switch is
// named by the label and described by the line under it.
export function SettingsSwitchRow({
  label,
  sub,
  checked,
  onCheckedChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const lineId = useId();
  return (
    <label className={SETTINGS_SWITCH_ROW_CLASS}>
      <span className="grid gap-0.5">
        <span className={SETTINGS_LABEL_CLASS}>{label}</span>
        <span id={lineId} className={SETTINGS_HINT_CLASS}>
          {sub}
        </span>
      </span>
      <MenuSwitch
        tone="accent"
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
        aria-describedby={lineId}
      />
    </label>
  );
}
