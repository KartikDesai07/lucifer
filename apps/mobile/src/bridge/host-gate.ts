// "Print all slips here" can only start while the app is on screen (Android
// refuses to start the background service otherwise). If the page asks while
// the app is hidden we answer { active: false }, remember the wish, and apply
// it the moment the app is visible again. Pure: no timers, no react-native.

export type HostApply = (
  active: boolean,
  label: string,
) => Promise<{ active: boolean }>;

export type HostGate = {
  setHostActive: HostApply;
  // Call when the app comes back to the foreground.
  onForeground(): Promise<void>;
};

export function createHostGate(
  apply: HostApply,
  isForeground: () => boolean,
): HostGate {
  let wish: { label: string } | null = null;

  return {
    async setHostActive(active, label) {
      if (active && !isForeground()) {
        wish = { label };
        return { active: false };
      }
      // Turning the host off is always safe, and it cancels a pending wish.
      wish = null;
      return apply(active, label);
    },
    async onForeground() {
      const pending = wish;
      wish = null;
      if (pending === null) {
        return;
      }
      try {
        await apply(true, pending.label);
      } catch {
        // the page asks again on its next beat
      }
    },
  };
}
