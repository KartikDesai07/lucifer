"use client";

// The page header's slot (U0 Task 3, values 2.5, design 5.3): the shell draws one 56px header for every page, and a
// page's PageHeader fills it. The page registers its title, description and eyebrow (plain data the header reads),
// and hands its actions over by a portal into the header's actions box, so they stay in the page's own React tree and
// exist exactly once; otherwise PageHeader keeps them in a row at the top of the page body. Where they go is decided
// here, once for the shell (ruling R6): in the header from 720px up, and only while they fit beside a title of at
// least 140px (measured with a ResizeObserver); on a phone, or when they do not fit, in the body row.
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { NAV_RAIL_MIN_PX } from "@/lib/pos-layout";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { HEADER_ICON_BUTTON_CLASS } from "@/components/layout/header-classes";

/** A back-link eyebrow, as the header draws it: a 36px button before the title. */
export interface PageHeaderBack {
  href: string;
  label: string;
}

/** What a page tells the header. */
export interface PageHeaderInfo {
  title: string;
  description?: string;
  /** A section eyebrow ("Service"): not shown (the HTML header has no section line), read before the title. */
  eyebrow?: string;
  back?: PageHeaderBack;
}

/** The page's side of the slot. */
export interface PageHeaderSlot {
  /** The actions go to the header (720px and up, with room beside the title); else to the body row. */
  actionsInHeader: boolean;
  /** Renders the actions inside the header (a portal in the shell). */
  renderInHeader: (actions: ReactNode) => ReactNode;
  /** Tells the header about the page; the returned function takes it back (only if it is still this page's). */
  register: (info: PageHeaderInfo) => () => void;
  /** The body row's callback ref: measured to know whether its actions would fit in the header. */
  bodyRowRef: (el: HTMLElement | null) => void;
}

interface HeaderSide {
  info: PageHeaderInfo | null;
  /** The header's actions box: a callback ref. */
  actionsRef: (el: HTMLElement | null) => void;
  /** The header's title block: a callback ref (measured). */
  titleRef: (el: HTMLElement | null) => void;
  /** The header's actions box once mounted: the /pos header measures it for its room rule (U1 Task 1, design 6.1). */
  actionsBox: HTMLElement | null;
}

export const PageHeaderSlotContext = createContext<PageHeaderSlot | null>(null);
const noRef = () => undefined;
const HeaderSideContext = createContext<HeaderSide>({ info: null, actionsRef: noRef, titleRef: noRef, actionsBox: null });

/** The narrowest the title block may get beside the page's actions (ruling R6); below it they go to the body row. */
export const HEADER_TITLE_MIN_PX = 140;
/** The header's gap between items (values 2.5). */
const HEADER_GAP_PX = 10;

/** Whether the page's actions fit in the header beside a readable title (ruling R6). The title block takes the
 *  header's free width, so with the actions in the header it is its width now; with them in the body row it is what
 *  would be left after them and one gap, were they moved up. The two agree at the boundary, so nothing flaps, because
 *  the body row lays the actions out the same 10px apart as the header's actions box (PageHeader's and Header's
 *  gap-2.5; final review I1: 8px there flipped two actions every frame in a 2px window). */
export function actionsFitBesideTitle(m: { actionsInHeader: boolean; titleWidth: number; actionsWidth: number }): boolean {
  const titleBesideActions = m.actionsInHeader ? m.titleWidth : m.titleWidth - m.actionsWidth - HEADER_GAP_PX;
  return titleBesideActions >= HEADER_TITLE_MIN_PX;
}

/** The width the body row's children take on one line (the row itself is full width). */
function childrenWidth(row: HTMLElement): number {
  const left = row.getBoundingClientRect().left;
  let right = left;
  for (const child of Array.from(row.children)) right = Math.max(right, child.getBoundingClientRect().right);
  return right - left;
}

const WIDE_QUERY = `(min-width: ${NAV_RAIL_MIN_PX}px)`;

function subscribeWide(onChange: () => void): () => void {
  const mql = window.matchMedia(WIDE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function PageHeaderSlotProvider({ children }: { children: ReactNode }) {
  // The shell renders on the client only (MasterDataProvider holds a placeholder on the server), so the first render
  // already reads the real width: the actions never start in the wrong place and move.
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
  const [room, setRoom] = useState(true);
  const [info, setInfo] = useState<PageHeaderInfo | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [titleEl, setTitleEl] = useState<HTMLElement | null>(null);
  const [bodyRow, setBodyRow] = useState<HTMLElement | null>(null);
  const actionsInHeader = wide && room;

  const register = useCallback((next: PageHeaderInfo) => {
    setInfo(next);
    return () => setInfo((current) => (current === next ? null : current));
  }, []);
  const renderInHeader = useCallback((actions: ReactNode) => (target ? createPortal(actions, target) : null), [target]);

  // Ruling R6: measured before the first paint and again whenever the title block or the body row resizes. With no
  // actions on the page there is nothing to place (no body row, a free title block), so nothing changes.
  const measure = useCallback(() => {
    if (!wide || !titleEl || (!actionsInHeader && !bodyRow)) return;
    const titleWidth = titleEl.getBoundingClientRect().width;
    const actionsWidth = actionsInHeader || !bodyRow ? 0 : childrenWidth(bodyRow);
    setRoom(actionsFitBesideTitle({ actionsInHeader, titleWidth, actionsWidth }));
  }, [wide, titleEl, bodyRow, actionsInHeader]);
  useLayoutEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (titleEl) observer.observe(titleEl);
    if (bodyRow) {
      observer.observe(bodyRow);
      for (const child of Array.from(bodyRow.children)) observer.observe(child);
    }
    return () => observer.disconnect();
  }, [measure, titleEl, bodyRow, info]);

  const slot = useMemo<PageHeaderSlot>(
    () => ({ actionsInHeader, renderInHeader, register, bodyRowRef: setBodyRow }),
    [actionsInHeader, renderInHeader, register],
  );
  const side = useMemo<HeaderSide>(() => ({ info, actionsRef: setTarget, titleRef: setTitleEl, actionsBox: target }), [info, target]);
  return (
    <PageHeaderSlotContext.Provider value={slot}>
      <HeaderSideContext.Provider value={side}>{children}</HeaderSideContext.Provider>
    </PageHeaderSlotContext.Provider>
  );
}

/** The header's side: what the current page registered, and the refs for the header's actions box and title block. */
export function usePageHeader(): HeaderSide {
  return useContext(HeaderSideContext);
}

/** The page's side, or null outside the shell. */
export function usePageHeaderSlot(): PageHeaderSlot | null {
  return useContext(PageHeaderSlotContext);
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

/** A non-string eyebrow that is a link (Settings sections, Festival cards, Expense categories): its href and words. */
export function backLinkOf(eyebrow: ReactNode): PageHeaderBack | undefined {
  if (!isValidElement<{ href?: unknown; children?: ReactNode }>(eyebrow)) return undefined;
  const { href, children } = eyebrow.props;
  if (typeof href !== "string") return undefined;
  return { href, label: textOf(children).replace(/\s+/g, " ").trim() };
}

/** The back link in the header: the HTML's 36px outline square with an arrow, before the title. */
export function PageHeaderBackLink({ back }: { back: PageHeaderBack }) {
  const name = `Back to ${back.label}`;
  return (
    <Link
      href={back.href}
      prefetch={false}
      aria-label={name}
      title={name}
      data-ui="header-back"
      className={cn(buttonVariants({ variant: "outline", size: "icon" }), HEADER_ICON_BUTTON_CLASS)}
    >
      <ArrowLeft aria-hidden="true" strokeWidth={1.8} />
    </Link>
  );
}
