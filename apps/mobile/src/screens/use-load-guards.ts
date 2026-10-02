// The POS WebView's load-event guards: the top-frame backstop (on top of the
// onShouldStartLoadWithRequest fence), the start-page HTTP-error path, and the
// de-duplicated "open in the system browser" action both fences share.

import {
  useCallback,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { Linking } from 'react-native';
import type { WebView } from 'react-native-webview';
import type {
  WebViewHttpErrorEvent,
  WebViewNavigationEvent,
} from 'react-native-webview/lib/WebViewTypes';
import { isStartPageFailure } from '../url';
import { isDuplicateOpen, type OpenedExternally } from './backstop';
import { useTopFrameBackstop } from './use-top-frame-backstop';

const noop = () => undefined;

type Args = {
  origin: string;
  webRef: RefObject<WebView<unknown> | null>;
  canGoBackRef: MutableRefObject<boolean>;
  onLoadError: () => void;
};

export function useLoadGuards({
  origin,
  webRef,
  canGoBackRef,
  onLoadError,
}: Args) {
  const openedRef = useRef<OpenedExternally>(null);
  // The fence callback and the backstop can both see one foreign page.
  const openExternal = useCallback((url: string) => {
    const now = Date.now();
    if (isDuplicateOpen(openedRef.current, url, now)) {
      return;
    }
    openedRef.current = { url, at: now };
    Linking.openURL(url).catch(noop);
  }, []);
  const guardTopFrame = useTopFrameBackstop({
    origin,
    webRef,
    openExternal,
    onGiveUp: onLoadError,
  });
  const onLoadStart = useCallback(
    (event: WebViewNavigationEvent) => guardTopFrame(event.nativeEvent.url),
    [guardTopFrame],
  );
  const onNavigationStateChange = useCallback(
    (nav: WebViewNavigationEvent['nativeEvent']) => {
      canGoBackRef.current = nav.canGoBack;
      guardTopFrame(nav.url);
    },
    [guardTopFrame, canGoBackRef],
  );
  // Android reports main-frame HTTP errors only. An error status on the start
  // page itself is "could not open the POS": show the retrying error screen.
  const onHttpError = useCallback(
    (event: WebViewHttpErrorEvent) => {
      const { url, statusCode } = event.nativeEvent;
      if (isStartPageFailure(url, statusCode, origin)) {
        onLoadError();
      }
    },
    [origin, onLoadError],
  );
  return { openExternal, onLoadStart, onNavigationStateChange, onHttpError };
}
