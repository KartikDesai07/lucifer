// Wires the bridge for ONE WebView instance. Mount this inside a component that
// is remounted (new `key`) whenever the WebView is: the token is requested once
// per mount, so a rebuilt WebView never reuses an old token.
// Nothing here uses a JS timer: the page -> app path must keep working while the
// app is in the background.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { nativePort, PosPrinter } from '../native/PosPrinter';
import { createHostGate } from './host-gate';
import { buildInjectedScript } from './injected';
import { createRouter, type NativePort, type Router } from './router';

export type NativeBridge = {
  // null until the token has arrived.
  script: string | null;
  router: Router | null;
  failed: boolean;
};

type Args = { origin: string; onChangeUrl: () => void; onBattery: () => void };

export function useNativeBridge({
  origin,
  onChangeUrl,
  onBattery,
}: Args): NativeBridge {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const changeUrlRef = useRef(onChangeUrl);
  useEffect(() => {
    changeUrlRef.current = onChangeUrl;
  }, [onChangeUrl]);
  const batteryRef = useRef(onBattery);
  useEffect(() => {
    batteryRef.current = onBattery;
  }, [onBattery]);

  useEffect(() => {
    let cancelled = false;
    PosPrinter.newToken().then(
      value => {
        if (!cancelled) {
          setToken(value);
        }
      },
      () => {
        if (!cancelled) {
          setFailed(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const gate = useMemo(
    () =>
      createHostGate(
        (active, label) => nativePort.setHostActive(active, label),
        () => AppState.currentState === 'active',
      ),
    [],
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        gate.onForeground();
      }
    });
    return () => subscription.remove();
  }, [gate]);

  const script = useMemo(
    () =>
      token === null
        ? null
        : buildInjectedScript({ token, platform: 'android' }),
    [token],
  );
  const router = useMemo(() => {
    if (token === null) {
      return null;
    }
    const port: NativePort = {
      ...nativePort,
      setHostActive: gate.setHostActive,
    };
    return createRouter({
      port,
      token,
      origin,
      deliver: reply => PosPrinter.deliverScript(reply),
      onChangeUrl: () => changeUrlRef.current(),
      onBattery: () => batteryRef.current(),
    });
  }, [token, origin, gate]);

  return { script, router, failed };
}
