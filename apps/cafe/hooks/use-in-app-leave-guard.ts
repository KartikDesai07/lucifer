"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  createLeaveGuardHistory,
  guardedLinkHref,
  type HistoryPort,
  type LeaveGuardHistory,
} from "@/lib/leave-guard";

// In-app "Discard changes?" guard for a dirty form. useUnsavedGuard covers a
// tab close / reload (beforeunload) and stays as is; this covers the two ways a
// Next soft navigation silently drops edits, which beforeunload never sees.
//
// LINKS: while dirty, a CAPTURE-phase click listener on `document` runs before
// React's root listener, so next/link never sees a guarded click. The click is
// swallowed and the dialog opens. On Discard the form is reset, then the same
// anchor is clicked again with the guard bypassed — a replay, so next/link AND
// any onClick the link carries (the sidebar closing its phone sheet) both run.
// If the anchor left the DOM meanwhile, router.push(href) is the fallback.
// The bypass flag exists for this replay only.
//
// BACK: the history logic lives in lib/leave-guard.ts (createLeaveGuardHistory,
// pure and tested against a fake history); this hook only feeds it popstate /
// hashchange and the dirty flag. A guard history entry (same URL, marked) is
// pushed on the first edit; Back pops it onto the page's own entry, which opens
// the dialog; Keep editing pushes it again; Discard resets and goes back. The
// guard entry is never popped on disarm — once clean, a Back across that
// same-URL step continues back (lazy removal), so there is no dead press.
export interface InAppLeaveGuard {
  prompting: boolean;
  keepEditing: () => void;
  leave: () => void;
}

type Pending = { kind: "link"; anchor: HTMLAnchorElement; href: string } | { kind: "back" } | null;

const windowHistoryPort: HistoryPort = {
  get state() {
    return window.history.state;
  },
  get href() {
    return window.location.href;
  },
  push: (state, href) => window.history.pushState(state, "", href),
  replace: (state, href) => window.history.replaceState(state, "", href),
  back: () => window.history.back(),
};

export function useInAppLeaveGuard(dirty: boolean, discard: () => void): InAppLeaveGuard {
  const router = useRouter();
  const [prompting, setPrompting] = useState(false);
  const bypassRef = useRef(false);
  const controllerRef = useRef<LeaveGuardHistory | null>(null);
  const pendingRef = useRef<Pending>(null);

  useEffect(() => {
    const controller = createLeaveGuardHistory(windowHistoryPort, () => {
      pendingRef.current = { kind: "back" };
      setPrompting(true);
    });
    controllerRef.current = controller;
    const onPopState = (e: PopStateEvent) => controller.onPopState(e.state);
    const onHashChange = () => controller.onHashChange();
    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
      controllerRef.current = null;
    };
  }, []);

  // Declared AFTER the mount effect so the controller exists when it runs.
  useEffect(() => {
    controllerRef.current?.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (bypassRef.current) return;
      const anchor = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = guardedLinkHref(
        e,
        { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") },
        window.location.href,
      );
      if (href === null) return;
      e.preventDefault();
      e.stopPropagation();
      pendingRef.current = { kind: "link", anchor, href };
      setPrompting(true);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const keepEditing = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setPrompting(false);
    if (pending?.kind === "back") controllerRef.current?.keepEditing();
  }, []);

  const leave = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setPrompting(false);
    // Reset first so nothing half-edited survives even if the leave lands on
    // this same page.
    discard();
    if (pending?.kind === "link") {
      bypassRef.current = true;
      if (pending.anchor.isConnected) pending.anchor.click();
      else router.push(pending.href);
      bypassRef.current = false;
    } else if (pending?.kind === "back") {
      controllerRef.current?.leaveBack();
    }
  }, [discard, router]);

  return { prompting, keepEditing, leave };
}
