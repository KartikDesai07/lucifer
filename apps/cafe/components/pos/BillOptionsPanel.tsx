"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { PopoverContent } from "@/components/ui/popover";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import { cn } from "@/lib/utils";
import type { BillSection } from "@/lib/pos-footer";

// U1 Task 5 (owner Q11, 2026-10-21; design 6.7; values 5.3 in docs/superpowers/specs/2026-10-20-pos-html-values.md):
// the cart footer's panels in the HTML's popover look. Today's three-dot More menu (D9.8, 2026-09-26) became the one
// "Bill options" panel the footer links open at their own section — Reward, Promo code, Discount, Extra charges, in the
// More menu's order — and the order note became its own panel in the same frame (components/pos/CartNotes.tsx).
//
// PRESENTATION ONLY, as the More menu was: the cart hands in its own controls (CartReward, CartPromo, the discount
// field, the GST preset, CartExtraCharges) and every piece of money state, validation and mutual exclusion stays where
// it lives (use-pos-tab / use-customer-rewards, assembled by buildCartProps). Nothing here computes a figure.
//
// A Popover, deliberately NOT a DropdownMenu: a DropdownMenuItem closes the menu on click and steals focus back to its
// trigger, which would make the discount field, the promo input and the charge form unusable. It hangs from the footer
// (the cart's PopoverAnchor) and opens upward over the lines, never over the bill and the buttons the operator is
// reading; it stays inside the cart (its collision boundary) and scrolls inside itself when the reward ladder is long.
// It closes with "Done", Escape, a tap outside it, or a second tap on the link that opened it; a tap on another link
// moves it to that link's section instead of closing it.

/** The HTML's popover frame (values 5.3): white, a 1px --border, radius 12, --pop, padding 14, its rows 12px apart; as
 *  wide as the cart less 12px each side (the HTML's left / right 12px); sheetIn .25s. Its height is the room above the
 *  footer inside the cart, its body scrolling. */
const PANEL_CLASS =
  "flex max-h-[var(--radix-popover-content-available-height)] w-[calc(var(--radix-popover-trigger-width)-24px)] flex-col gap-3 overflow-hidden rounded-[12px] border border-border bg-card p-3.5 text-foreground leading-[normal] [box-shadow:var(--pop)]! origin-center data-[state=open]:animate-html-sheet-in-fast! data-[state=closed]:animate-none!";
/** The panel's title (values 5.3 "Order details"): 13px 600. */
export const PANEL_TITLE_CLASS = "text-[13px] font-semibold";
/** "Done" (values 5.3): 13.5px 600 --link, no padding. */
const DONE_CLASS = cn("cursor-pointer bg-transparent p-0 text-[13.5px] font-semibold text-link", BRAND_PRESS_CLASS);
/** A section's caption (design 6.7): 12px 600 --text-2. */
const CAPTION_CLASS = "text-[12px] font-semibold text-muted-foreground";

/** What takes the focus when a section opens: its first live control. */
const FIRST_FIELD = "input:not([disabled]):not([readonly]), textarea:not([disabled]), button:not([disabled])";

// A press on the links row is the footer's own business (switch the section, or close on a second tap), never a
// dismissal from outside.
const onLinksRow = (target: EventTarget | null) => target instanceof Element && target.closest("[data-ui='pos-footer-links']") !== null;

interface FooterPanelProps {
  /** The panel's accessible name (its role is dialog). */
  label: string;
  title: ReactNode;
  /** The section to bring into view and focus (its data-bill-section); "note" or any other key: the first field. */
  focusKey: string;
  /** The cart the panel must stay inside. */
  boundary: Element | null;
  onDone: () => void;
  children: ReactNode;
  dataUi: string;
}

/** The frame both footer panels share: the HTML's popover with its title row and "Done", over a scrolling body. */
export function FooterPanel({ label, title, focusKey, boundary, onDone, children, dataUi }: FooterPanelProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // The tapped section scrolls to the top of the body and its first field takes the focus (design 6.7). Two frames
  // later: the popper places the panel and sets its height after it mounts, so the body only scrolls once placed.
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const body = bodyRef.current;
        if (!body) return;
        const section = body.querySelector<HTMLElement>(`[data-bill-section="${focusKey}"]`);
        if (section) body.scrollTop = section.offsetTop;
        const field = (section ?? body).querySelector<HTMLElement>(FIRST_FIELD);
        (field ?? body).focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  return (
    <PopoverContent
      data-ui={dataUi}
      aria-label={label}
      side="top"
      align="center"
      sideOffset={-6}
      avoidCollisions={false}
      collisionBoundary={boundary ?? undefined}
      collisionPadding={12}
      onOpenAutoFocus={(e) => e.preventDefault()}
      onInteractOutside={(e) => {
        if (onLinksRow(e.detail.originalEvent.target)) e.preventDefault();
      }}
      className={PANEL_CLASS}
    >
      <div className="flex flex-none items-center justify-between gap-2.5">
        {title}
        <button type="button" className={DONE_CLASS} onClick={onDone}>
          Done
        </button>
      </div>
      <div ref={bodyRef} tabIndex={-1} className="relative flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain outline-none">
        {children}
      </div>
    </PopoverContent>
  );
}

/** One section of the Bill options panel: its caption over today's control (design 6.7). */
export function BillOptionsSection({ id, caption, children }: { id: BillSection; caption: string; children: ReactNode }) {
  const captionId = useId();
  return (
    <div role="group" aria-labelledby={captionId} data-bill-section={id} className="flex flex-col gap-2">
      <p id={captionId} className={CAPTION_CLASS}>
        {caption}
      </p>
      {children}
    </div>
  );
}

/** The one "Bill options" panel the Discount, Promo code, Reward and Extra charge links open (owner Q11). */
export function BillOptionsPanel({
  section,
  boundary,
  onDone,
  children,
}: {
  /** The section the operator tapped. */
  section: BillSection;
  boundary: Element | null;
  onDone: () => void;
  /** The sections, in today's More-menu order. */
  children: ReactNode;
}) {
  return (
    <FooterPanel
      dataUi="pos-bill-options"
      label="Bill options"
      title={<span className={PANEL_TITLE_CLASS}>Bill options</span>}
      focusKey={section}
      boundary={boundary}
      onDone={onDone}
    >
      {children}
    </FooterPanel>
  );
}
