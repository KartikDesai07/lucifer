"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ChevronDown, CircleCheck } from "lucide-react";
import { cn, inr } from "@/lib/utils";
import { plural } from "@/lib/dashboard/format";
import { menuItemsHref } from "@/lib/menu-sections";
import { STATUS_CLASSES, type StatusKind } from "@/lib/ui";
import { DashSkeleton } from "@/components/dashboard/DashCard";
import { StatusDot } from "@/components/shared/StatusPill";
import type { DashboardLive } from "@/types/dashboard";

// "Needs attention" — what someone should act on RIGHT NOW, whatever period the numbers below show. Only non-zero
// items appear, most urgent first, each a link with a status dot. U0 match Task 5 (values 3.1, design 5.5): our five
// live counts in the owner's HTML chip — a bold part, the rest, an action pill — after the uppercase label while the
// content is at least 560px wide (the HTML's attWide); below that one card (attMob) whose 48px row ("4 · Needs
// attention" and the bold parts) opens the list. The HTML's sizes on touch screens too (ruling R1).

export interface AttentionItem {
  key: string;
  kind: StatusKind;
  /** The bold part ("2 QR orders"). */
  strong: string;
  /** The words after it ("waiting"). */
  rest: string;
  /** The action pill ("View"). */
  action: string;
  href: string;
  title?: string;
}

/** Our live counts as the HTML's attention items, in our order (requests first); a zero count has no item. */
export function attentionItems(live: DashboardLive): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (live.pendingRequests > 0) {
    items.push({ key: "requests", kind: "warn", strong: plural(live.pendingRequests, "QR order"), rest: "waiting", action: "View", href: "/requests" });
  }
  if (live.openTabs.count > 0) {
    items.push({
      key: "tabs",
      kind: "info",
      strong: plural(live.openTabs.count, "open tab"),
      rest: `· ${inr(live.openTabs.value)}`,
      action: "Open",
      href: "/orders?payment=Unpaid&status=Pending",
    });
  }
  if (live.bookingsToday > 0) {
    items.push({ key: "bookings", kind: "reserved", strong: plural(live.bookingsToday, "booking"), rest: "today", action: "View", href: "/reservations" });
  }
  if (live.unavailable.count > 0) {
    const more = live.unavailable.count - live.unavailable.names.length;
    items.push({
      key: "unavailable",
      kind: "bad",
      strong: plural(live.unavailable.count, "item"),
      rest: "unavailable",
      action: "View",
      href: menuItemsHref({ status: "out-of-stock" }),
      title: `${live.unavailable.names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`,
    });
  }
  if (live.dues.total > 0) {
    items.push({
      key: "dues",
      kind: "bill",
      strong: `${inr(live.dues.total)} due`,
      rest: `from ${plural(live.dues.customers, "customer")}`,
      action: "Collect",
      href: "/customers",
    });
  }
  return items;
}

const FOCUS_CLASS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
// values 3.1: the chip (34px, padding 0 5px 0 12px, radius 17) and its action pill (24px, padding 0 10px, radius 12).
const CHIP_CLASS = cn(
  "flex h-[34px] items-center gap-[9px] whitespace-nowrap rounded-[17px] border border-border bg-card pl-3 pr-[5px] text-[13px] text-foreground transition-colors hover:border-subtle-foreground",
  FOCUS_CLASS,
);
const PILL_CLASS = "flex h-6 items-center rounded-[12px] bg-surface-3 px-2.5 text-[12px] font-semibold";
// The phone card's rows (46px, padding 8px 12px) and their action (28px, padding 0 11px, radius 8).
const ITEM_CLASS = cn("flex min-h-[46px] items-center gap-2.5 px-3 py-2 text-left text-[13px] text-foreground focus-visible:ring-inset", FOCUS_CLASS);
const ITEM_ACTION_CLASS = "flex h-7 flex-none items-center rounded-[8px] bg-surface-3 px-[11px] text-[12px] font-semibold";
const SAID_CLASS = "text-[13px] text-muted-foreground";
// The HTML's rise (values 1.5) on the row and the card: 0.4s, from 12px below.
const RISE_CLASS = "motion-safe:animate-[brand-rise_0.4s_cubic-bezier(0.2,0.8,0.2,1)_both]";

function Words({ item }: { item: AttentionItem }) {
  return (
    <>
      <b className="font-semibold">{item.strong}</b> {item.rest}
    </>
  );
}

export function AttentionStrip({ live, loading, isError }: { live?: DashboardLive; loading: boolean; isError: boolean }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const items = live ? attentionItems(live) : [];
  const waiting = loading && !live;

  // Said instead of chips, in both layouts: the counts failed, or nothing to act on.
  const status = waiting ? null : isError && !live ? (
    <p className={SAID_CLASS}>Couldn&apos;t load the live counts. Trying again…</p>
  ) : items.length === 0 ? (
    <p className={cn("flex items-center gap-1.5", SAID_CLASS)}>
      <CircleCheck className="h-4 w-4 text-status-ok-ink" aria-hidden />
      All clear — nothing needs attention right now.
    </p>
  ) : null;

  return (
    <section aria-label="Needs attention">
      {/* cw 560 and up: the label, then the chips, wrapping onto a second line when they do not fit. */}
      <div data-ui="attention-wide" className={cn("hidden min-h-[34px] flex-wrap items-center gap-2 @min-[560px]:flex", RISE_CLASS)}>
        <h2
          data-ui="attention-label"
          className="mr-1 flex shrink-0 items-center gap-[7px] text-[11.5px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"
        >
          <StatusDot kind="warn" className="size-[7px] rounded-[50%]" />
          Needs attention
        </h2>
        {waiting ? (
          <>
            <DashSkeleton className="h-[34px] w-36 rounded-[17px]" />
            <DashSkeleton className="h-[34px] w-40 rounded-[17px]" />
            <DashSkeleton className="h-[34px] w-32 rounded-[17px]" />
          </>
        ) : status ? (
          status
        ) : (
          items.map((item) => (
            <Link key={item.key} href={item.href} title={item.title} data-ui="attention-chip" className={CHIP_CLASS}>
              <StatusDot kind={item.kind} className="rounded-[50%]" />
              <span>
                <Words item={item} />
              </span>
              <span data-ui="attention-pill" className={PILL_CLASS}>
                {item.action}
              </span>
            </Link>
          ))
        )}
      </div>

      {/* Under cw 560: one card whose row opens the list. */}
      <div
        data-ui="attention-card"
        className={cn("flex flex-col overflow-hidden rounded-[12px] border border-border bg-card @min-[560px]:hidden", RISE_CLASS)}
      >
        {waiting ? (
          <div className="flex h-12 items-center gap-2.5 px-3">
            <DashSkeleton className="size-7 rounded-[8px]" />
            <DashSkeleton className="h-4 w-44" />
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
              data-ui="attention-toggle"
              className={cn("flex h-12 w-full min-w-0 items-center gap-2.5 px-3 text-left text-foreground", FOCUS_CLASS, "focus-visible:ring-inset")}
            >
              <span
                data-ui="attention-count"
                className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-status-warn-tint text-[13px] font-bold text-status-warn-ink"
              >
                {items.length}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">Needs attention</span>
                <span data-ui="attention-peek" className="block truncate text-[12px] text-muted-foreground">
                  {items.map((item) => item.strong).join(" · ")}
                </span>
              </span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground motion-safe:transition-transform motion-safe:duration-200",
                  open ? "[transform:rotate(180deg)]" : "[transform:rotate(0deg)]",
                )}
                aria-hidden
              />
            </button>
            <ul id={listId} hidden={!open} data-ui="attention-list" className="flex flex-col border-t border-border-2">
              {items.map((item, i) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    title={item.title}
                    data-ui="attention-item"
                    className={cn(ITEM_CLASS, i > 0 && "border-t border-border-2")}
                  >
                    <span aria-hidden="true" data-ui="attention-item-dot" className={cn("mx-2.5 size-2 flex-none rounded-[50%]", STATUS_CLASSES[item.kind].dot)} />
                    <span className="min-w-0 flex-1 leading-[1.35]">
                      <Words item={item} />
                    </span>
                    <span data-ui="attention-item-action" className={ITEM_ACTION_CLASS}>
                      {item.action}
                    </span>
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
