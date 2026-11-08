// The error boundaries' automatic reload (Printing Phase 5, spec 5.10; plan Task 15), kept apart from every other
// module so app/global-error.tsx stays free of shared imports: only the page's offline state.

import { serverReach, type ServerReachStore } from "@/lib/server-reach";

/** The one meaning of "the line is up" for a reload: the page's offline state says online and the browser agrees. */
export function lineIsUp(
  store: Pick<ServerReachStore, "isOffline"> = serverReach,
  win: { navigator: { onLine: boolean } } = window,
): boolean {
  return !store.isOffline() && win.navigator.onLine !== false;
}

/** The error boundaries' automatic reload (a missing build chunk): a page that reloads without the internet cannot
 *  open, so it waits for the connection (the screen's own Reload button stays). Returns its cleanup. */
export function reloadWhenOnline(
  reload: () => void,
  store: ServerReachStore = serverReach,
  win: Pick<Window, "addEventListener" | "removeEventListener"> & { navigator: { onLine: boolean } } = window,
): () => void {
  const ready = () => lineIsUp(store, win);
  if (ready()) {
    reload();
    return () => undefined;
  }
  let done = false;
  const check = () => {
    if (done || !ready()) return;
    done = true;
    stop();
    reload();
  };
  const offStore = store.subscribe(check);
  win.addEventListener("online", check);
  const stop = () => {
    offStore();
    win.removeEventListener("online", check);
  };
  return stop;
}
