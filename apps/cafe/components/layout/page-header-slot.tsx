"use client";

// The page header's slot (U0 Task 3, values 2.5, design 5.3): the shell draws one 56px header for every page, and a
// page's PageHeader fills it. The page registers its title, description and eyebrow (plain data the header reads),
// and hands its actions over by a portal into the header's actions box from 720px up, so they stay in the page's own
// React tree and exist exactly once; below 720px PageHeader keeps them in a row at the top of the page body. One
// media query, read here for the whole shell, makes that choice.
import {
  createContext,
  isValidElement,
  useCallback,
  useContext,
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
import { PRINTER_ICON_BUTTON_CLASS } from "@/components/print/printer-classes";

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
  /** 720px and up: the actions go to the header; below, to a row at the top of the page body. */
  wide: boolean;
  /** Renders the actions inside the header (a portal in the shell). */
  inHeader: (actions: ReactNode) => ReactNode;
  /** Tells the header about the page; the returned function takes it back (only if it is still this page's). */
  register: (info: PageHeaderInfo) => () => void;
}

interface HeaderSide {
  info: PageHeaderInfo | null;
  /** The header's actions box: a callback ref. */
  actionsRef: (el: HTMLElement | null) => void;
}

export const PageHeaderSlotContext = createContext<PageHeaderSlot | null>(null);
const HeaderSideContext = createContext<HeaderSide>({ info: null, actionsRef: () => undefined });

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
  const [info, setInfo] = useState<PageHeaderInfo | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const register = useCallback((next: PageHeaderInfo) => {
    setInfo(next);
    return () => setInfo((current) => (current === next ? null : current));
  }, []);
  const inHeader = useCallback((actions: ReactNode) => (target ? createPortal(actions, target) : null), [target]);

  const slot = useMemo<PageHeaderSlot>(() => ({ wide, inHeader, register }), [wide, inHeader, register]);
  const side = useMemo<HeaderSide>(() => ({ info, actionsRef: setTarget }), [info]);
  return (
    <PageHeaderSlotContext.Provider value={slot}>
      <HeaderSideContext.Provider value={side}>{children}</HeaderSideContext.Provider>
    </PageHeaderSlotContext.Provider>
  );
}

/** The header's side: what the current page registered, and the ref for the header's actions box. */
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
      className={cn(buttonVariants({ variant: "outline", size: "icon" }), PRINTER_ICON_BUTTON_CLASS)}
    >
      <ArrowLeft aria-hidden="true" strokeWidth={1.8} />
    </Link>
  );
}
