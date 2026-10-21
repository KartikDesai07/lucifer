"use client";

import { useCallback, useLayoutEffect, useState } from "react";

import { BrandTile } from "@/components/layout/BrandTile";
import { NavDeviceLine } from "@/components/layout/NavDeviceLine";
import { PRINTER_DOT_OK_CLASS, PRINTER_DOT_WARN_CLASS } from "@/components/print/printer-classes";
import { VENDOR_PRODUCT_NAME } from "@/lib/constants";
import { clockPrinterWords, posClockLabel } from "@/lib/pos-clock";
import { posHeaderRoom, posSwitchMinPx, type PosHeaderRoom } from "@/lib/pos-layout";
import type { PrinterDotTone } from "@/lib/printer/printer-dot";
import { cn } from "@/lib/utils";

// The /pos header's own parts (the owner's HTML Order header, values 1.2-1.4; design 6.1; U1 Task 1): the brand block
// before the actions box (the phone's mini logo; from 720px, and not beside the wide nav, the cafe's name in Shrikhand
// over the nav's "{product} · {device}" line) and the clock block after it ("● Printer" and the time, from 720px).
// The dot is the printer button's own tone, handed over by the header (no second printer read, request or poll); the
// time is the header's once-a-minute clock.
//
// The room rule (design 6.1, ruling R6's measuring pattern): when our extra header buttons (Refresh in the apps,
// Tokens when on) leave the actions box narrower than the switch-order button's minimum, the brand text hides first,
// then the clock block. A hidden part stays laid out (out of the row, unseen), so its width is always measured fresh.

/** A part the room rule hides: out of the row and unseen, still measurable; held at the header's right edge (the header
 *  is its positioned ancestor while a part is out: data-room-out in Header.tsx), so its box never widens the page. */
const ROOM_HIDDEN_CLASS = "invisible absolute right-0";

const CLOCK_DOT_CLASS: Record<PrinterDotTone, string> = {
  green: PRINTER_DOT_OK_CLASS,
  red: PRINTER_DOT_WARN_CLASS,
  none: "bg-transparent",
};

export interface PosHeaderRoomState {
  /** 0 everything shows; 1 the brand text is out; 2 the clock block is out too. */
  level: PosHeaderRoom;
  /** The brand text and the clock block, measured. */
  brandRef: (el: HTMLElement | null) => void;
  clockRef: (el: HTMLElement | null) => void;
}

const widthOf = (el: Element | null | undefined): number => (el ? el.getBoundingClientRect().width : 0);

/** The switch-order button the page portals into the actions box (components/pos/PosHeader.tsx), if it is there. */
const switchIn = (box: HTMLElement): HTMLElement | null => box.querySelector<HTMLElement>("[data-ui='pos-switch']");

/** The button's narrowest, from its parts: every child but the text column (the only part that shrinks), its gap, its
 *  paddings and border. */
function switchMinOf(button: HTMLElement): number {
  const style = getComputedStyle(button);
  const px = (value: string) => parseFloat(value) || 0;
  const fixedParts = Array.from(button.children)
    .filter((child) => child.getAttribute("data-ui") !== "pos-switch-text")
    .map(widthOf);
  const edges = px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth);
  return posSwitchMinPx({ fixedParts, gap: px(style.columnGap), edges });
}

/** Measures the /pos header (when `enabled`) before the first paint and whenever the actions box, a part or the
 *  switch-order button resizes. The button's minimum is its own, measured (U1 Task 6): it arrives by a portal after
 *  the header mounts and its "N open" pill changes with the count, so the box's contents are watched too. */
export function usePosHeaderRoom(enabled: boolean, actionsBox: HTMLElement | null): PosHeaderRoomState {
  const [level, setLevel] = useState<PosHeaderRoom>(0);
  const [brandEl, setBrandEl] = useState<HTMLElement | null>(null);
  const [clockEl, setClockEl] = useState<HTMLElement | null>(null);
  const measure = useCallback(() => {
    if (!enabled || !actionsBox) return;
    const button = switchIn(actionsBox);
    const switchMin = button ? switchMinOf(button) : undefined;
    setLevel((room) =>
      posHeaderRoom({ room, actionsWidth: widthOf(actionsBox), brandWidth: widthOf(brandEl), clockWidth: widthOf(clockEl), switchMin }),
    );
  }, [enabled, actionsBox, brandEl, clockEl]);
  useLayoutEffect(() => {
    measure();
    if (!enabled || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    const observeAll = () => {
      for (const el of [actionsBox, brandEl, clockEl, actionsBox && switchIn(actionsBox)]) if (el) observer.observe(el);
    };
    observeAll();
    let contents: MutationObserver | null = null;
    if (actionsBox && typeof MutationObserver !== "undefined") {
      contents = new MutationObserver(() => {
        observeAll();
        measure();
      });
      contents.observe(actionsBox, { childList: true, subtree: true, characterData: true });
    }
    return () => {
      observer.disconnect();
      contents?.disconnect();
    };
  }, [measure, enabled, actionsBox, brandEl, clockEl]);
  return { level: enabled ? level : 0, brandRef: setBrandEl, clockRef: setClockEl };
}

interface PosHeaderBrandProps {
  name: string;
  /** The cafe's own logo for the phone's mini tile, or null for the letter (as the other pages' header). */
  logoUrl: string | null;
  room: PosHeaderRoomState;
}

export function PosHeaderBrand({ name, logoUrl, room }: PosHeaderBrandProps) {
  return (
    <div data-ui="pos-header-brand" className="flex min-w-max items-center gap-2.5">
      <BrandTile key={logoUrl ?? "initial"} name={name} logoUrl={logoUrl} size="mini" dataUi="header-mini-logo" className="tab:hidden" />
      <div ref={room.brandRef} data-ui="pos-header-brand-text" className={cn("hidden flex-col tab:flex wide:hidden", room.level >= 1 && ROOM_HIDDEN_CLASS)}>
        <span data-ui="pos-header-brand-name" className="font-brand-script text-[20px] font-normal leading-[1.1] text-brand-red">
          {name}
        </span>
        <NavDeviceLine lead={VENDOR_PRODUCT_NAME} dataUi="pos-header-brand-line" className="text-[12px] leading-[1.3] text-muted-foreground" />
      </div>
    </div>
  );
}

interface PosHeaderClockProps {
  /** The header's minute clock. */
  now: Date;
  /** The printer button's dot. */
  tone: PrinterDotTone;
  room: PosHeaderRoomState;
}

export function PosHeaderClock({ now, tone, room }: PosHeaderClockProps) {
  // The dot is decoration: its state is said in words too, for screen readers only (never colour alone).
  const printerWords = clockPrinterWords(tone);
  return (
    <div ref={room.clockRef} data-ui="pos-clock" className={cn("hidden h-7 min-w-max items-center gap-3.5 border-l border-border pl-4 tab:flex", room.level >= 2 && ROOM_HIDDEN_CLASS)}>
      <span data-ui="pos-clock-printer" className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <span aria-hidden="true" data-ui="pos-clock-dot" className={cn("size-1.5 rounded-[50%]", CLOCK_DOT_CLASS[tone])} />
        Printer
        {printerWords && <span className="sr-only"> {printerWords}</span>}
      </span>
      <span data-ui="pos-clock-time" className="text-[13px] font-medium">{posClockLabel(now)}</span>
    </div>
  );
}
