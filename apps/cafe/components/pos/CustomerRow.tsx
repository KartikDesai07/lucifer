"use client";

import { Check } from "lucide-react";

import { cn, inr } from "@/lib/utils";
import { AVATAR_HUES, avatarHueIndex } from "@/lib/ui";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { Customer } from "@/types";

// One search result in the customer sheet (U1 Task 10; values 8.2 in docs/superpowers/specs/2026-10-20-pos-html-values.md;
// design 6.12): 9px 10px, radius 10, 12px apart, rising in turn (30 ms apart), hover --hover; the current customer on
// --accent-t with a check where the HTML puts its tag. The avatar 38px round, 13px 600 initials in U0's tint for the name;
// the name 14px 600 over the mobile in Geist Mono 12.5px --text-2 (masked for staff by the server); on the right, 12px
// --text-2 at 1.4: the visits, and our due in --bad-i. A tap attaches the customer and closes the sheet (CustomerSearch).
const ROW_CLASS =
  "flex w-full cursor-pointer items-center gap-3 rounded-[10px] border-0 px-2.5 py-[9px] text-left text-foreground hover:bg-hover motion-safe:animate-html-rise-cs";
const ROW_CURRENT_CLASS = "bg-accent";
const ROW_OTHER_CLASS = "bg-transparent";
const AVATAR_CLASS = "flex size-[38px] flex-none items-center justify-center rounded-[50%] text-[13px] font-semibold";
const NAME_LINE_CLASS = "flex items-center gap-1.5 whitespace-nowrap text-[14px] font-semibold";
const PHONE_CLASS = "block font-mono text-[12.5px] text-muted-foreground";
const RIGHT_CLASS = "flex-none text-right text-[12px] leading-[1.4] text-muted-foreground";

/** The HTML's ini2 (values 8.2): the first letters of the first two words, upper-cased. */
function initials(name: string): string {
  return name.trim().split(/\s+/).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
}

/** "1 visit", "12 visits" (never the HTML's "1 visits"). */
function visitsText(visits: number): string {
  return `${visits} visit${visits === 1 ? "" : "s"}`;
}

export function CustomerRow({
  customer: c,
  index,
  current,
  onPick,
}: {
  customer: Customer;
  /** Its place in the list: the rise's delay (values 8.2 d = index × 30 ms). */
  index: number;
  current: boolean;
  onPick: (customer: Customer) => void;
}) {
  const hue = AVATAR_HUES[avatarHueIndex(c.name)];
  return (
    <button
      type="button"
      data-ui="cs-row"
      aria-current={current ? "true" : undefined}
      onClick={() => onPick(c)}
      style={{ animationDelay: `${(index * 0.03).toFixed(2)}s` }}
      className={cn(ROW_CLASS, current ? ROW_CURRENT_CLASS : ROW_OTHER_CLASS, BRAND_PRESS_CLASS)}
    >
      <span aria-hidden="true" className={AVATAR_CLASS} style={{ backgroundColor: hue.bg, color: hue.fg }}>
        {initials(c.name)}
      </span>
      <span className="min-w-0 flex-1">
        <span className={NAME_LINE_CLASS}>
          <span className="overflow-hidden text-ellipsis">{c.name}</span>
          {current && <Check aria-hidden="true" className="size-4 flex-none text-primary" />}
        </span>
        <span className={PHONE_CLASS}>{c.mobile}</span>
      </span>
      <span className={RIGHT_CLASS}>
        {visitsText(c.visits)}
        {c.totalDue > 0 && (
          <>
            <br />
            <span className="text-status-bad-ink">Due {inr(c.totalDue)}</span>
          </>
        )}
      </span>
    </button>
  );
}
