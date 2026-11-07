/** The one store for "a page is opening". A tap on a link starts it; the page showing up (a new pathname) settles it.
 *  Pure on purpose: no window, no clock. The caller passes the time and the paths in, so node:test covers all of it. */

/** After this long the opening screen says it is taking longer than usual. */
export const NAV_STILL_OPENING_MS = 8000;

export type NavProgress = { href: string; label: string; startedAt: number; fromPath: string } | null;

/** The path an href points at: query and hash dropped, an absolute URL reduced to its pathname, and a trailing
 *  slash on a non-root path removed, so "/orders/?a=1" and "/orders" name the same page. */
export function navTargetPath(href: string): string {
  let path = href;
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(href)) {
    try {
      path = new URL(href, "http://localhost").pathname;
    } catch {
      path = href;
    }
  }
  path = path.split("#")[0].split("?")[0];
  if (path === "") return "/";
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

export function createNavProgress() {
  let state: NavProgress = null;
  // Paths of taps this navigation replaced: one of them landing late must not end the newer tap's wait.
  let superseded: string[] = [];
  const listeners = new Set<() => void>();

  const set = (next: NavProgress) => {
    state = next;
    listeners.forEach((fn) => fn());
  };
  const clear = () => {
    superseded = [];
    set(null);
  };

  return {
    get: (): NavProgress => state,
    /** Begin (or replace) the opening. False, and nothing changes, when this exact href is already opening. */
    start(href: string, label: string, now: number, fromPath: string): boolean {
      if (state && state.href === href) return false;
      const path = navTargetPath(href);
      if (state) {
        const old = navTargetPath(state.href);
        if (old !== path && !superseded.includes(old)) superseded.push(old);
      }
      superseded = superseded.filter((p) => p !== path);
      set({ href, label, startedAt: now, fromPath });
      return true;
    },
    /** The page now showing is `pathname`. The target (or any path the tap did not come from and did not
     *  replace, e.g. a redirect) ends the wait; the old path or a replaced tap's path keeps it. */
    settle(pathname: string): void {
      if (!state) return;
      if (pathname === navTargetPath(state.href)) return clear();
      if (pathname === state.fromPath || superseded.includes(pathname)) return;
      clear();
    },
    cancel(): void {
      if (state) clear();
    },
    stillOpening: (now: number): boolean => state !== null && now - state.startedAt >= NAV_STILL_OPENING_MS,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

/** The page's one instance. */
export const navProgress = createNavProgress();
