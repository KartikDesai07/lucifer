"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Ticket } from "lucide-react";

import { detailMeta, detailSteps, type DetailMetaIcon, type DetailStepState } from "@/lib/order-detail-view";
import { orderNumber, orderTitle, recentOrderCode, type AgeTone } from "@/lib/orders-row";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Order } from "@/types";

// The order detail's head (U2 Task 5; values 11.2, 11.3; design 6.7): the ink code tile, the title and "#014", the meta
// row with the HTML's icons, the ✕ in the sheets only, and the steps box. The words: lib/order-detail-view.ts.

const HEAD_CLASS = "flex flex-none flex-col gap-3.5 border-b border-border px-[18px] py-4";
const TILE_CLASS =
  "flex size-[46px] flex-none items-center justify-center rounded-[12px] bg-ink text-[13.5px] font-bold text-on-ink";
const NAME_CLASS = "truncate text-[18px] font-semibold tracking-[-0.01em]";
const META_CLASS = "mt-1 flex flex-wrap gap-x-2.5 gap-y-1 text-[12.5px] text-muted-foreground";
/** The ✕ (values 11.2): 34px round on --surface-3, 12px --text-2, the UA's 1px 6px (the HTML sets none); no hover. */
const CLOSE_CLASS =
  "flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-[12px] text-muted-foreground";
const STEPS_CLASS = "grid rounded-[12px] border border-border-2 bg-surface-2 px-3 pt-3 pb-2.5";

/** The open clock's colour (values 0.1): an hour --bad-i, 30 minutes --warn-i (600), else the meta's --text-2. */
const META_TONE: Record<AgeTone, string> = {
  bad: "font-semibold text-status-bad-ink",
  warn: "font-semibold text-status-warn-ink",
  plain: "font-normal text-muted-foreground",
};

/** values 11.2 `ST`: the dot, the label and the time per state (the status colours are lib/ui's); the connector is --ok
 *  after a done step, else --border. */
const STEP_LOOK: Record<DetailStepState, { dot: string; label: string; time: string }> = {
  done: { dot: STATUS_CLASSES.ok.dot, label: "text-foreground", time: "text-subtle-foreground" },
  cur: { dot: "bg-card [box-shadow:inset_0_0_0_3px_var(--color-primary)]", label: "text-accent-foreground", time: "text-accent-foreground" },
  todo: { dot: "bg-surface-3", label: "text-subtle-foreground", time: "text-subtle-foreground" },
  bad: { dot: STATUS_CLASSES.bad.dot, label: STATUS_CLASSES.bad.ink, time: "text-subtle-foreground" },
  due: { dot: STATUS_CLASSES.bill.dot, label: STATUS_CLASSES.bill.ink, time: "text-subtle-foreground" },
};

/** The HTML's meta glyphs (values 11.2 `MI`: a table, a person, a clock), 24x24 outline paths. */
const META_PATHS: Record<Exclude<DetailMetaIcon, "token">, string> = {
  type: "M3 11h18M12 11v9M7 20h10M6 11V5M18 11V5",
  staff: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
};

/** A meta icon (values 11.2): 13px, stroke 1.9, round caps and joins, never shrinking, at .8; the token's is our ticket
 *  glyph (the Token button's). */
function MetaIcon({ icon }: { icon: DetailMetaIcon }) {
  const look = { "data-ui": "order-detail-meta-icon", className: "flex-none", opacity: 0.8 } as const;
  if (icon === "token") return <Ticket size={13} strokeWidth={1.9} aria-hidden {...look} />;
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden {...look}>
      <path d={META_PATHS[icon]} />
    </svg>
  );
}

interface OrderDetailHeadProps {
  order: Order;
  /** The minute tick the clock's age reads. */
  now: Date;
  /** In a sheet (a dialog): its close, drawn as the HTML's ✕; the name is then the dialog's title. The column has none. */
  onClose?: () => void;
}

export function OrderDetailHead({ order, now, onClose }: OrderDetailHeadProps) {
  const meta = detailMeta(order, now);
  const steps = detailSteps(order);
  const name = (
    <span data-ui="order-detail-name" className={NAME_CLASS}>
      {orderTitle(order)}
    </span>
  );
  return (
    <div data-ui="order-detail-head" className={HEAD_CLASS}>
      <div data-ui="order-detail-top" className="flex items-start gap-3">
        <span data-ui="order-detail-tile" className={TILE_CLASS}>
          {recentOrderCode(order)}
        </span>
        <div data-ui="order-detail-title" className="min-w-0 flex-1">
          <div data-ui="order-detail-name-row" className="flex min-w-0 items-baseline gap-2">
            {onClose ? <DialogPrimitive.Title asChild>{name}</DialogPrimitive.Title> : name}
            <span data-ui="order-detail-number" className="flex-none font-mono text-[12.5px] text-subtle-foreground">
              {orderNumber(order)}
            </span>
          </div>
          <div data-ui="order-detail-meta" className={META_CLASS}>
            {meta.map((m) => (
              <span key={m.icon} data-ui="order-detail-meta-item" className={cn("flex items-center gap-[5px] whitespace-nowrap", META_TONE[m.tone])}>
                <MetaIcon icon={m.icon} />
                {m.text}
              </span>
            ))}
          </div>
        </div>
        {onClose && (
          <button type="button" data-ui="order-detail-close" title="Close" aria-label="Close" onClick={onClose} className={CLOSE_CLASS}>
            ✕
          </button>
        )}
      </div>
      <div data-ui="order-detail-steps" className={cn(STEPS_CLASS, steps.length === 2 ? "grid-cols-2" : "grid-cols-4")}>
        {steps.map((s, i) => {
          const look = STEP_LOOK[s.state];
          return (
            <div key={s.label} data-ui="order-detail-step" className="flex min-w-0 flex-col gap-[7px]">
              <div className="flex items-center">
                <span data-ui="order-detail-step-dot" className={cn("flex size-3.5 flex-none items-center justify-center rounded-[50%] text-white", look.dot)}>
                  <svg data-ui="order-detail-step-tick" width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity={s.state === "done" ? 1 : 0} aria-hidden>
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                </span>
                <span
                  data-ui="order-detail-step-line"
                  aria-hidden
                  className={cn("mx-1.5 h-0.5 flex-1 rounded-[1px]", s.state === "done" ? STATUS_CLASSES.ok.dot : "bg-border", i === steps.length - 1 && "opacity-0")}
                />
              </div>
              <span data-ui="order-detail-step-label" className={cn("truncate pr-1.5 text-[12px] font-semibold", look.label)}>
                {s.label}
              </span>
              {/* Its 14px line kept when empty: a settled bill has no time on any step (we store no paid-at time), and the
                  box keeps the HTML's 78px (where its last step carries the payment's time). */}
              <span data-ui="order-detail-step-time" className={cn("-mt-1 min-h-[14px] whitespace-nowrap text-[11px]", look.time)}>
                {s.time}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
