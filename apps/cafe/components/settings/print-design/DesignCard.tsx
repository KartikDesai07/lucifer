"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

interface DesignCardProps {
  selected: boolean;
  label: string;
  blurb: string;
  /** The card's picture (a real slip, scaled down). */
  children: ReactNode;
  onPick: () => void;
}

// One design in a gallery: its picture, name and one line about it. A tap changes only the unsaved draft.
export function DesignCard({ selected, label, blurb, children, onPick }: DesignCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={cn(
        "flex w-full min-w-0 flex-col gap-2 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
        selected ? "border-brand-primary bg-brand-primary-soft" : "border-brand-rule bg-brand-slip hover:bg-brand-wash",
      )}
    >
      {children}
      <span className="flex min-w-0 items-start justify-between gap-1">
        <span className="min-w-0">
          <span className="block break-words text-sm font-medium text-brand-ink">{label}</span>
          <span className="block break-words text-xs text-brand-muted">{blurb}</span>
        </span>
        {selected && <Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-brand-primary" />}
      </span>
    </button>
  );
}
