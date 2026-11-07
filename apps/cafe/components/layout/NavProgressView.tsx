"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { NavSkeleton } from "@/components/layout/NavSkeleton";
import { useNavProgress } from "@/hooks/use-nav-progress";
import { heldRoutes } from "@/lib/held-routes";
import { navProgress, type NavProgress } from "@/lib/nav-progress";
import { coverOf, skeletonKindOf, stillOpeningIn } from "@/lib/nav-skeleton";

// What the staff see while a screen opens (P2 N1). A tap starts the navigation store (lib/navigate.ts); in that same
// frame this view hides the page and shows the target screen's skeleton, the header draws a 2px line under itself
// (NavProgressLine) and the tapped row lights up (AppLink). Covering lasts while the path is still the one the tap came
// from (lib/nav-skeleton.ts coverOf), so the new screen, or a redirect landing anywhere else, shows at once.
// The page is HIDDEN, never unmounted: its queries, the pulse and printing keep running under the skeleton, and Back
// shows it again as it was. The wrapper is `display: contents` while shown, so the page's own height chain inside
// <main> is untouched.

/** The dashboard's <main> content: the page, and while a tap's screen opens, its skeleton. Settles the store. */
export function NavProgressView({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const cover = coverOf(useNavProgress(), pathname);

  // Before paint, on mount and on every new pathname: the screen that just drew ends the wait (so no frame shows the
  // skeleton over it), and the visit counts as held for an offline tap later (lib/navigate.ts).
  useLayoutEffect(() => {
    if (!pathname) return;
    navProgress.settle(pathname);
    heldRoutes.mark(pathname, Date.now());
  }, [pathname]);

  // A page restored from the back-forward cache (Back after a full load) comes back with the store as it was at the
  // tap: it must never return under a skeleton. Back / Forward while a screen opens: Next drops the pending navigation,
  // and a step to an entry on the same path changes no pathname, so nothing else would end the wait.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) navProgress.cancel();
    };
    const onPop = () => navProgress.cancel();
    window.addEventListener("pageshow", onShow);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // Hiding the page (display: none) clamps the window's scroll to the skeleton's height. So the offset is kept at the
  // tap, from the store's own notice (it runs inside the tap, before React draws the skeleton), and put back before
  // paint if the same page shows again (Back, a dropped navigation, a bfcache restore). A landed screen keeps Next's.
  const kept = useRef<{ path: string; y: number } | null>(null);
  useEffect(
    () =>
      navProgress.subscribe(() => {
        const next = navProgress.get();
        if (next !== null && kept.current === null) kept.current = { path: next.fromPath, y: window.scrollY };
      }),
    [],
  );
  useLayoutEffect(() => {
    if (cover !== null) return;
    const was = kept.current;
    kept.current = null;
    if (was !== null && was.path === pathname) window.scrollTo(0, was.y);
  }, [cover, pathname]);

  return <NavProgressFrame cover={cover}>{children}</NavProgressFrame>;
}

/** The view's markup for a given cover (pure, so it is render-tested). */
export function NavProgressFrame({ cover, children }: PropsWithChildren<{ cover: NavProgress }>) {
  return (
    <>
      <div data-ui="nav-page" className={cover ? undefined : "contents"} hidden={cover !== null}>
        {children}
      </div>
      {cover && (
        <>
          <StillOpening cover={cover} />
          <NavSkeleton kind={skeletonKindOf(cover.href)} />
        </>
      )}
    </>
  );
}

/** After 8 s: the words, a full load of the target (Try again) and the old screen back (Back). The status region is
 *  there, empty, from the tap, so a screen reader hears the words when they come; it sits outside the busy skeleton. */
function StillOpening({ cover }: { cover: NonNullable<NavProgress> }) {
  const [late, setLate] = useState<NavProgress>(null);

  // One timer per navigation, to 8 s after the tap; cleared when the navigation ends or another tap replaces it.
  // The store has the last word (a wall clock moved back waits for the rest).
  useEffect(() => {
    let timer = 0;
    const check = () => {
      // Ended or replaced before this render caught up: the next render's own run takes over.
      if (navProgress.get() !== cover) return;
      if (navProgress.stillOpening(Date.now())) setLate(cover);
      else timer = window.setTimeout(check, stillOpeningIn(cover, Date.now()));
    };
    timer = window.setTimeout(check, stillOpeningIn(cover, Date.now()));
    return () => window.clearTimeout(timer);
  }, [cover]);

  const shown = late === cover;
  return (
    <div data-ui="nav-still-opening" className={shown ? "mb-4 flex flex-wrap items-center gap-3" : undefined}>
      <p role="status" aria-live="polite" className={shown ? "w-full text-sm text-muted-foreground tab:w-auto" : "sr-only"}>
        {shown ? "Still opening…" : ""}
      </p>
      {shown && (
        <>
          <Button type="button" variant="outline" className="h-11 px-6" onClick={() => window.location.assign(cover.href)}>
            Try again
          </Button>
          <Button type="button" variant="outline" className="h-11 px-6" onClick={() => navProgress.cancel()}>
            Back
          </Button>
        </>
      )}
    </div>
  );
}

/** The 2px line under the header (the header renders it as its last child; app/nav-progress.css places and moves it).
 *  `pos`: the /pos header is static, so the line is placed from the shell's column there. */
export function NavProgressLine({ pos }: { pos: boolean }) {
  const pathname = usePathname() ?? "";
  const cover = coverOf(useNavProgress(), pathname);
  if (!cover) return null;
  return <div data-ui="nav-line" data-pos={pos ? "" : undefined} role="progressbar" aria-label={`Opening ${cover.label}`} />;
}
