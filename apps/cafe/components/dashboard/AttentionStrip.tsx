"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleCheck } from "lucide-react";
import { cn, inr } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import { menuItemsHref } from "@/lib/menu-sections";
import { STATUS_CLASSES, type StatusKind } from "@/lib/ui";
import { BrandSkeleton } from "@/components/dashboard/DashCard";
import { StatusDot } from "@/components/shared/StatusPill";
import type { DashboardLive } from "@/types/dashboard";

// "Needs attention" — what someone should act on RIGHT NOW, whatever period
// the numbers below show. Only non-zero items appear, most urgent first, each a
// link with a status dot (owner's mock-up). From `sm` the chips wrap after an
// uppercase label; on a phone they fold into one summary row ("5 · Needs
// attention") that opens the list.

interface Chip {
  key: string;
  kind: StatusKind;
  text: string;
  href: string;
  title?: string;
}

function chipsOf(live: DashboardLive): Chip[] {
  const chips: Chip[] = [];
  if (live.pendingRequests > 0) {
    chips.push({ key: "requests", kind: "warn", text: `${plural(live.pendingRequests, "QR order")} waiting`, href: "/requests" });
  }
  if (live.openTabs.count > 0) {
    chips.push({
      key: "tabs",
      kind: "info",
      text: `${plural(live.openTabs.count, "open tab")} · ${inr(live.openTabs.value)}`,
      href: "/orders?payment=Unpaid&status=Pending",
    });
  }
  if (live.bookingsToday > 0) {
    chips.push({ key: "bookings", kind: "reserved", text: `${plural(live.bookingsToday, "booking")} today`, href: "/reservations" });
  }
  if (live.unavailable.count > 0) {
    const more = live.unavailable.count - live.unavailable.names.length;
    chips.push({
      key: "unavailable",
      kind: "bad",
      text: `${plural(live.unavailable.count, "item")} unavailable`,
      href: menuItemsHref({ status: "out-of-stock" }),
      title: `${live.unavailable.names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    });
  }
  if (live.dues.total > 0) {
    chips.push({
      key: "dues",
      kind: "bill",
      text: `${inr(live.dues.total)} due from ${plural(live.dues.customers, "customer")}`,
      href: "/customers",
    });
  }
  return chips;
}

const FOCUS_CLASS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent";
const CHIP_CLASS = cn(
  "inline-flex h-[34px] items-center gap-[9px] whitespace-nowrap rounded-full border border-brand-rule bg-brand-slip px-3 text-[13px] text-brand-ink transition-colors hover:border-brand-field pointer-coarse:h-11",
  FOCUS_CLASS,
);
const ROW_CLASS = cn(
  "flex min-h-[46px] items-center gap-2.5 px-3 py-2 text-[13px] leading-snug text-brand-ink hover:bg-brand-wash focus-visible:ring-inset",
  FOCUS_CLASS,
);

export function AttentionStrip({ live, loading, isError }: { live?: DashboardLive; loading: boolean; isError: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const chips = live ? chipsOf(live) : [];
  const waiting = loading && !live;

  // Said instead of chips, in both layouts: the counts failed, or nothing to act on.
  const status = waiting ? null : isError && !live ? (
    <p className="text-[13px] text-brand-muted">Couldn&apos;t load the live counts. Trying again…</p>
  ) : chips.length === 0 ? (
    <p className="flex items-center gap-1.5 text-[13px] text-brand-muted">
      <CircleCheck className="h-4 w-4 text-brand-up" aria-hidden />
      All clear — nothing needs attention right now.
    </p>
  ) : null;

  return (
    <section aria-label="Needs attention">
      {/* sm and up: the label, then the chips wrapping onto a second line on a tablet. */}
      <div className="hidden min-h-[34px] flex-wrap items-center gap-2 sm:flex">
        <h2 className="mr-1 flex shrink-0 items-center gap-[7px] text-[11.5px] font-semibold uppercase tracking-[0.07em] text-brand-muted">
          <StatusDot kind="warn" className="h-[7px] w-[7px]" />
          Needs attention
        </h2>
        {waiting ? (
          <>
            <BrandSkeleton className="h-[34px] w-36 rounded-full" />
            <BrandSkeleton className="h-[34px] w-40 rounded-full" />
            <BrandSkeleton className="h-[34px] w-32 rounded-full" />
          </>
        ) : status ? (
          status
        ) : (
          chips.map((c) => (
            <Link key={c.key} href={c.href} title={c.title} className={CHIP_CLASS}>
              <StatusDot kind={c.kind} />
              {c.text}
            </Link>
          ))
        )}
      </div>

      {/* A phone: one summary row that opens the list. */}
      <div className="overflow-hidden rounded-xl border border-brand-rule bg-brand-slip sm:hidden">
        {waiting ? (
          <div className="flex h-12 items-center gap-2.5 px-3">
            <BrandSkeleton className="h-7 w-7 rounded-lg" />
            <BrandSkeleton className="h-4 w-44" />
          </div>
        ) : status ? (
          <div className="flex min-h-12 items-center px-3 py-2">{status}</div>
        ) : (
          <>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((o) => !o)}
              className={cn("flex h-12 w-full min-w-0 items-center gap-2.5 px-3 text-left text-brand-ink", FOCUS_CLASS, "focus-visible:ring-inset")}
            >
              <span
                className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold", STATUS_CLASSES.warn.pill)}
              >
                {chips.length}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">Needs attention</span>
                <span className="block truncate text-[12px] text-brand-muted">{chips.map((c) => c.text).join(" · ")}</span>
              </span>
              <ChevronDown
                className={cn("h-4 w-4 shrink-0 text-brand-muted motion-safe:transition-transform", open && "rotate-180")}
                aria-hidden
              />
            </button>
            <ul id={listId} hidden={!open} className="border-t border-brand-rule">
              {chips.map((c, i) => (
                <li key={c.key} className={i > 0 ? "border-t border-brand-rule" : undefined}>
                  <Link href={c.href} title={c.title} className={ROW_CLASS}>
                    <StatusDot kind={c.kind} className="mx-2.5" />
                    {c.text}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
