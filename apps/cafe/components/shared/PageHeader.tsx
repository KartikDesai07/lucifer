"use client";

import { useLayoutEffect, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { backLinkOf, usePageHeaderSlot } from "@/components/layout/page-header-slot";

interface PageHeaderProps {
  title: string;
  eyebrow?: ReactNode; // the section ("Service"), or a back link to the page above
  description?: string;
  actions?: ReactNode;
  className?: string;
}

// The page's header, drawn by the shell (U0 Task 3, values 2.5, design 5.3): every page has the HTML's one 56px
// header, so a page no longer draws a title block of its own. PageHeader tells the shell's header the title (its
// <h1>), the description (its second line) and the eyebrow (a section word is read to screen readers only; a back
// link becomes a 36px button before the title), before the first paint. Its actions sit in the header from 720px up
// and, on a phone (where the HTML's header holds icon buttons only), once in a row at the top of the page body;
// `className` styles that row. Outside the shell there is no header to fill, so the actions stay in the body.
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  const slot = usePageHeaderSlot();
  const register = slot?.register;
  const eyebrowText = typeof eyebrow === "string" ? eyebrow : undefined;
  const link = backLinkOf(eyebrow);
  const backHref = link?.href;
  const backLabel = link?.label;

  useLayoutEffect(() => {
    if (!register) return;
    const back = backHref === undefined ? undefined : { href: backHref, label: backLabel ?? "" };
    return register({ title, description, eyebrow: eyebrowText, back });
  }, [register, title, description, eyebrowText, backHref, backLabel]);

  if (!actions) return null;
  if (slot?.wide) return <>{slot.inHeader(actions)}</>;
  return (
    <div data-ui="page-actions" className={cn("flex flex-wrap items-center gap-2", className)}>
      {actions}
    </div>
  );
}
