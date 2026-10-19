"use client";

import { PageHeaderBackLink, type PageHeaderBack } from "@/components/layout/page-header-slot";

interface HeaderTitleProps {
  title: string;
  subtitle: string;
  /** The page's section word ("Service"): read to screen readers before the title, not shown. */
  eyebrow: string | undefined;
  back: PageHeaderBack | undefined;
  /** The title block, measured by the slot (ruling R6: the page's actions sit beside at least 140px of it). */
  titleRef: (el: HTMLElement | null) => void;
}

// The page header's left side after the phone's menu and logo (the owner's HTML, values 2.5; U0 Task 3): a back link
// when the page has one, then the HTML's flex:1 + min-width:0 title block: the page's h1 (15px/600 at 1.2) over its
// 12px text-2 second line, cut with an ellipsis.
export function HeaderTitle({ title, subtitle, eyebrow, back, titleRef }: HeaderTitleProps) {
  return (
    <>
      {back && <PageHeaderBackLink back={back} />}
      <div ref={titleRef} data-ui="header-title-block" className="min-w-0 flex-1">
        {eyebrow && <span className="sr-only">{`${eyebrow}: `}</span>}
        <h1 data-ui="header-title" className="text-[15px] font-semibold leading-[1.2]">{title}</h1>
        <p data-ui="header-subtitle" className="truncate text-[12px] text-muted-foreground">
          {subtitle}
        </p>
      </div>
    </>
  );
}
