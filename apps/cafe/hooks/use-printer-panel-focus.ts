"use client";

import { useEffect, useRef, type FocusEvent, type RefObject } from "react";

import type { PrinterPanelView } from "@/hooks/use-printer-views";

// The printer panel's focus (PX-2 Task 6, F-M6; moved out of PrinterPanel.tsx as it was in PX-3 Task 10, so the panel keeps
// room for its views): a view switch keeps the sheet, scrolls back to the top and focuses the part a fix pointed at, else the
// new view's title (on /printers, which has no title of its own, leaving the connect view focuses this device's printer
// card: it shows how the connect ended); the Not printed card leaving while it held the focus hands it to the status card's
// headline.

const FRAME_SELECTOR = '[data-ui="printer-panel"]';
const BODY_SELECTOR = '[data-ui="printer-panel-body"]';
const TITLE_SELECTOR = '[data-ui="printer-panel-title"]';
const HEADLINE_SELECTOR = '[data-ui="printer-status-headline"]';
/** This device's printer card (its section is focusable, tabIndex -1): the panel's setup fixes point at it too. */
export const DEVICE_SECTION_SELECTOR = '[data-printer-target="device"]';

// Targets are looked up inside THIS panel, never the whole page (the sheet and /printers can both be mounted).
function focusAndShow(root: HTMLElement | null, selector: string): boolean {
  const target = root?.querySelector<HTMLElement>(selector) ?? null;
  if (target === null) return false;
  target.scrollIntoView({ block: "center" });
  target.focus({ preventScroll: true });
  return true;
}

export interface PrinterPanelFocus {
  rootRef: RefObject<HTMLDivElement | null>;
  listRef: RefObject<HTMLDivElement | null>;
  onFocus(event: FocusEvent): void;
  openSetup(selector: string): void;
}

export function usePrinterPanelFocus({ home, view, onView }: { home: "sheet" | "page"; view: PrinterPanelView; onView?: (next: "status" | "settings") => void }): PrinterPanelFocus {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listFocused = useRef(false);
  const hadList = useRef(false);
  const shownView = useRef(view);
  const pendingTarget = useRef<string | null>(null);

  // F-M6: a view switch keeps the sheet; it scrolls back to the top, and the focus goes to the part an action pointed at
  // (today's focusAndShow), else to the new view's title.
  useEffect(() => {
    if (shownView.current === view) return;
    const from = shownView.current;
    shownView.current = view;
    const frame = rootRef.current?.closest<HTMLElement>(FRAME_SELECTOR) ?? null;
    const body = frame?.querySelector<HTMLElement>(BODY_SELECTOR) ?? null;
    if (body !== null) body.scrollTop = 0;
    const target = pendingTarget.current;
    pendingTarget.current = null;
    if (target !== null && focusAndShow(rootRef.current, target)) return;
    if (frame === null && from === "connect" && focusAndShow(rootRef.current, DEVICE_SECTION_SELECTOR)) return;
    frame?.querySelector<HTMLElement>(TITLE_SELECTOR)?.focus({ preventScroll: true });
  }, [view]);

  // F-M6: the Not printed card left (Clear all, the last Clear, its slips printing) while it held the focus: the status
  // card's headline takes it. A focus that went elsewhere is never moved.
  useEffect(() => {
    const has = (listRef.current?.childElementCount ?? 0) > 0;
    const left = hadList.current && !has;
    hadList.current = has;
    if (!left || !listFocused.current) return;
    listFocused.current = false;
    const active = document.activeElement;
    const frame = rootRef.current?.closest(FRAME_SELECTOR) ?? null;
    if (active !== null && active !== document.body && active !== frame) return;
    rootRef.current?.querySelector<HTMLElement>(HEADLINE_SELECTOR)?.focus({ preventScroll: true });
  });

  const openSetup = (selector: string): void => {
    if (home === "page") {
      focusAndShow(rootRef.current, selector);
      return;
    }
    pendingTarget.current = selector;
    onView?.("settings");
  };
  const onFocus = (event: FocusEvent): void => {
    listFocused.current = listRef.current?.contains(event.target as Node) ?? false;
  };
  return { rootRef, listRef, onFocus, openSetup };
}
