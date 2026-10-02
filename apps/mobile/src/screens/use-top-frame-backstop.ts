// Top-frame backstop for the POS WebView. onShouldStartLoadWithRequest is the
// main fence, but on Android the library answers it from a cache and defaults
// to ALLOW after a short wait, so a foreign page can still begin loading. This
// hook watches the load events that follow: a foreign top-frame page is stopped,
// opened outside the app when it is a web page, and the WebView goes back to the
// start page. Sub-frames never reach it (these events are main-frame only).

import { useCallback, useRef, type RefObject } from 'react';
import type { WebView } from 'react-native-webview';
import { startUrl, topFrameBackstop } from '../url';
import { CRASH_URL, spendRecovery } from './backstop';

type Args = {
  origin: string;
  webRef: RefObject<WebView<unknown> | null>;
  // Opens a web page in the system browser (de-duplicated by the caller).
  openExternal: (url: string) => void;
  // Called instead of looping when the recovery budget is spent.
  onGiveUp: () => void;
};

export function useTopFrameBackstop({
  origin,
  webRef,
  openExternal,
  onGiveUp,
}: Args) {
  const handledRef = useRef<string | null>(null);
  const spentRef = useRef<number[]>([]);

  return useCallback(
    (url: string) => {
      if (__DEV__ && url === CRASH_URL) {
        return; // the dev-menu "Crash web page" navigates here on purpose
      }
      const action = topFrameBackstop(url, origin);
      if (action === 'none') {
        handledRef.current = null;
        return;
      }
      // onLoadStart and onNavigationStateChange both report the same page.
      if (handledRef.current === url) {
        return;
      }
      handledRef.current = url;
      const web = webRef.current;
      web?.stopLoading();
      const budget = spendRecovery(spentRef.current, Date.now());
      spentRef.current = budget.times;
      if (!budget.allowed) {
        onGiveUp();
        return;
      }
      if (action === 'recover-and-open') {
        openExternal(url);
      }
      web?.injectJavaScript(
        'window.location.replace(' +
          JSON.stringify(startUrl(origin)) +
          ');true;',
      );
    },
    [origin, webRef, openExternal, onGiveUp],
  );
}
