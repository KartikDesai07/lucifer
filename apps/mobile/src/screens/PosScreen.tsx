// The POS itself: a full-screen WebView locked to the saved address.
//
// Start-up order matters. The WebView is first rendered WITHOUT a source; once
// the bridge token exists the native module installs the bridge script at true
// document start (attachWebView), and only then do we set the source, so the
// very first page load already has window.PosNative. Without that support the
// script goes through the library's before-content-loaded fallback.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import {
  BackHandler,
  DevSettings,
  findNodeHandle,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { useNativeBridge } from '../bridge/use-native-bridge';
import { PosPrinter } from '../native/PosPrinter';
import { classifyNavigation, isSameOrigin, startUrl } from '../url';
import { usedAfterFailure } from './auto-retry';
import { CRASH_URL } from './backstop';
import { LoadErrorScreen } from './LoadErrorScreen';
import { colors } from './theme';
import { useLoadGuards } from './use-load-guards';
import { WorkspaceCover } from './WorkspaceCover';
import { buildPagePaintScript, isPageReadyMessage } from './page-presentation';

export const ATTACH_RETRY_MAX = 5;
export const ATTACH_RETRY_MS = 100;
const noop = () => undefined;

type Props = { origin: string; onChangeUrl: () => void };

// Debug builds only: "Crash web page" in the dev menu proves the WebView
// is rebuilt (with a new token) after its renderer dies.
let crashHook: (() => void) | null = null;
let devMenuAdded = false;
function addDevMenuOnce() {
  if (!__DEV__ || devMenuAdded) {
    return;
  }
  devMenuAdded = true;
  try {
    DevSettings.addMenuItem('Crash web page', () => crashHook?.());
  } catch {
    // dev menu not available (tests)
  }
}

type WebProps = Props & { onLoadError: () => void; onRenderGone: () => void };

function PosWebView({
  origin,
  onChangeUrl,
  onLoadError,
  onRenderGone,
}: WebProps) {
  const hostRef = useRef<ComponentRef<typeof View>>(null);
  const webRef = useRef<WebView<unknown>>(null);
  const canGoBackRef = useRef(false);
  const crashNavRef = useRef(false);
  const bridge = useNativeBridge({ origin, onChangeUrl });
  const [documentStart, setDocumentStart] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  // True once native delivery holds THIS WebView (a resolved attachWebView).
  const attachedRef = useRef(false);

  useEffect(() => {
    if (bridge.failed) {
      onLoadError();
    }
  }, [bridge.failed, onLoadError]);

  useEffect(() => {
    const script = bridge.script;
    if (script === null) {
      return undefined;
    }
    const tag = findNodeHandle(hostRef.current);
    if (typeof tag !== 'number') {
      setDocumentStart(false);
      return undefined;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The native view may not exist the instant React commits; retry briefly,
    // then fall back to the library's own injection.
    const attempt = (n: number) => {
      PosPrinter.attachWebView(tag, script, origin).then(
        result => {
          if (!cancelled) {
            attachedRef.current = true;
            setDocumentStart(result.documentStart === true);
          }
        },
        () => {
          if (cancelled) {
            return;
          }
          if (n >= ATTACH_RETRY_MAX) {
            setDocumentStart(false);
          } else {
            timer = setTimeout(() => attempt(n + 1), ATTACH_RETRY_MS);
          }
        },
      );
    };
    attempt(1);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [bridge.script, origin]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (canGoBackRef.current) {
          webRef.current?.goBack();
        } else {
          // never finish the activity: that would stop the print host with it
          PosPrinter.moveTaskToBack().catch(noop);
        }
        return true;
      },
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    addDevMenuOnce();
    crashHook = () => {
      crashNavRef.current = true;
      webRef.current?.injectJavaScript(
        "window.location.href='" + CRASH_URL + "';true;",
      );
    };
    return () => {
      crashHook = null;
    };
  }, []);

  const source = useMemo(
    () => (documentStart === null ? undefined : { uri: startUrl(origin) }),
    [documentStart, origin],
  );

  const { openExternal, onLoadStart, onNavigationStateChange, onHttpError } =
    useLoadGuards({ origin, webRef, canGoBackRef, onLoadError });

  const onShouldStart = useCallback(
    (request: ShouldStartLoadRequest) => {
      if (__DEV__ && crashNavRef.current && request.url === CRASH_URL) {
        crashNavRef.current = false;
        return true;
      }
      const verdict = classifyNavigation(
        request.url,
        origin,
        request.isTopFrame ?? true,
      );
      if (verdict === 'external') {
        openExternal(request.url);
      }
      return verdict === 'allow';
    },
    [origin, openExternal],
  );

  // A failed attach left native delivery without a WebView, so replies and
  // events would never reach the page. Once a page has loaded the view surely
  // exists: attach again (the injected script is idempotent, so a second
  // install for later loads is harmless).
  const onLoadEnd = useCallback(() => {
    const script = bridge.script;
    if (attachedRef.current || script === null) {
      return;
    }
    const tag = findNodeHandle(hostRef.current);
    if (typeof tag !== 'number') {
      return;
    }
    PosPrinter.attachWebView(tag, script, origin).then(() => {
      attachedRef.current = true;
    }, noop);
  }, [bridge.script, origin]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const { data, url } = event.nativeEvent;
      if (isPageReadyMessage(data, url, origin)) {
        setLoading(false);
        return;
      }
      bridge.router?.handle(data, url).catch(noop);
    },
    [bridge.router, origin],
  );

  const fallbackScript = documentStart === false ? bridge.script : null;

  return (
    <SafeAreaView style={styles.root}>
      <View ref={hostRef} collapsable={false} style={styles.root}>
        <WebView<unknown>
          ref={webRef}
          source={source}
          originWhitelist={['*']}
          onShouldStartLoadWithRequest={onShouldStart}
          onMessage={onMessage}
          injectedJavaScriptBeforeContentLoaded={fallbackScript ?? undefined}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly
          injectedJavaScriptForMainFrameOnly
          onNavigationStateChange={onNavigationStateChange}
          onLoadStart={onLoadStart}
          onLoadEnd={onLoadEnd}
          onLoad={event => {
            if (isSameOrigin(event.nativeEvent.url, origin)) {
              webRef.current?.injectJavaScript(buildPagePaintScript(origin));
            }
          }}
          onError={onLoadError}
          onHttpError={onHttpError}
          onRenderProcessGone={onRenderGone}
          onContentProcessDidTerminate={onRenderGone}
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled
          mixedContentMode="never"
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          geolocationEnabled={false}
          thirdPartyCookiesEnabled={false}
          textZoom={100}
          webviewDebuggingEnabled={__DEV__}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          cacheEnabled
          cacheMode="LOAD_DEFAULT"
          style={styles.web}
        />
        <WorkspaceCover
          ready={!loading}
          origin={origin}
          onRetry={onRenderGone}
        />
      </View>
    </SafeAreaView>
  );
}

export function PosScreen({ origin, onChangeUrl }: Props) {
  const [generation, setGeneration] = useState(0);
  const [failed, setFailed] = useState(false);
  // Automatic retries spent since the last healthy run or tap; the error screen
  // is remounted by every retry, so the count lives here.
  const [autoRetries, setAutoRetries] = useState(0);
  const startedAtRef = useRef(Date.now());

  // A fresh WebView (key) always gets a fresh bridge token.
  const remount = useCallback(() => {
    startedAtRef.current = Date.now();
    setFailed(false);
    setGeneration(g => g + 1);
  }, []);
  const retryByTap = useCallback(() => {
    setAutoRetries(0);
    remount();
  }, [remount]);
  const retryAutomatically = useCallback(() => {
    setAutoRetries(n => n + 1);
    remount();
  }, [remount]);
  const showError = useCallback(() => {
    const ranMs = Date.now() - startedAtRef.current;
    setAutoRetries(n => usedAfterFailure(n, ranMs));
    setFailed(true);
  }, []);

  if (failed) {
    return (
      <LoadErrorScreen
        onRetry={retryByTap}
        onChangeAddress={onChangeUrl}
        autoRetriesUsed={autoRetries}
        onAutoRetry={retryAutomatically}
      />
    );
  }
  return (
    <PosWebView
      key={generation}
      origin={origin}
      onChangeUrl={onChangeUrl}
      onLoadError={showError}
      onRenderGone={remount}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  web: { flex: 1, backgroundColor: colors.background },
});
