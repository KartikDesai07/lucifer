"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { PAGE_IN_KEYFRAMES, PAGE_IN_TIMING } from "@/lib/shell-layout";

// The HTML's pageIn (values 1.5 and 3.0, ruling R11): a page fades in and rises 6px over .4s when it opens. This hidden
// marker sits first in the shell's <main> (the page content) and replays the fade on <main> with the Web Animations API
// whenever the path changes: a query change alone never replays it, and nothing is keyed or remounted, so the column
// keeps its header, the request strip (with its sound unlock), the header slot and the print sources. No motion when
// the device asks for less. The transform lasts only while the fade runs (fill: backwards), so a fixed child is placed
// by the viewport again the moment it ends.
export function PageFade() {
  const pathname = usePathname();
  const marker = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const page = marker.current?.parentElement;
    if (!page || typeof page.animate !== "function") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fade = page.animate(PAGE_IN_KEYFRAMES, PAGE_IN_TIMING);
    return () => fade.cancel();
  }, [pathname]);

  return <span ref={marker} hidden aria-hidden="true" data-ui="page-fade" />;
}
