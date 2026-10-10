/**
 * Sandbee POS mobile shell: loads the POS from one saved address.
 *
 * @format
 */

import { useCallback, useEffect, useState } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PosPrinter } from './src/native/PosPrinter';
import { LoadErrorScreen } from './src/screens/LoadErrorScreen';
import { PosScreen } from './src/screens/PosScreen';
import { BootScreen } from './src/screens/Brand';
import { UrlScreen } from './src/screens/UrlScreen';
import { normalizePosUrl } from './src/url';

type Boot =
  | { kind: 'loading' }
  | { kind: 'url'; initial: string }
  | { kind: 'pos'; origin: string }
  | { kind: 'error' };

const noop = () => undefined;

/** First run only (no saved address): the splash stays long enough to be seen, as in the Sandbee app. A saved
 *  address opens the POS at once. */
export const FIRST_RUN_SPLASH_MS = 1400;

function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    async function start() {
      try {
        const saved = await PosPrinter.getSavedOrigin();
        if (cancelled) {
          return;
        }
        const checked = saved === null ? null : normalizePosUrl(saved);
        if (checked !== null && checked.ok) {
          setBoot({ kind: 'pos', origin: checked.origin });
          return;
        }
        if (saved !== null) {
          await PosPrinter.clearOrigin(); // a saved address that no longer passes the rules
        }
        const wait = FIRST_RUN_SPLASH_MS - (Date.now() - startedAt);
        if (wait > 0) {
          await new Promise(resolve => setTimeout(resolve, wait));
        }
        if (!cancelled) {
          setBoot({ kind: 'url', initial: '' });
        }
      } catch {
        if (!cancelled) {
          setBoot({ kind: 'error' });
        }
      }
    }
    start();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const changeUrl = useCallback(() => {
    const initial = boot.kind === 'pos' ? boot.origin : '';
    // Phase 3 (the 3D review gate, m-1): this device stops printing for the POS it leaves (its page goes with it and can
    // never say so): no service, no "POS printing is off" after a reboot; a new address's page asks again if it prints.
    PosPrinter.setHostActive(false, '')
      .catch(noop)
      .then(() => PosPrinter.clearOrigin())
      .catch(noop)
      .then(() => setBoot({ kind: 'url', initial }));
  }, [boot]);

  const retryBoot = useCallback(() => {
    setBoot({ kind: 'loading' });
    setAttempt(n => n + 1);
  }, []);

  let screen;
  if (boot.kind === 'pos') {
    screen = (
      <PosScreen
        key={boot.origin}
        origin={boot.origin}
        onChangeUrl={changeUrl}
      />
    );
  } else if (boot.kind === 'url') {
    screen = (
      <UrlScreen
        initialValue={boot.initial}
        onSaved={origin => setBoot({ kind: 'pos', origin })}
      />
    );
  } else if (boot.kind === 'error') {
    screen = (
      <LoadErrorScreen
        onRetry={retryBoot}
        onChangeAddress={() => setBoot({ kind: 'url', initial: '' })}
      />
    );
  } else {
    screen = <BootScreen />;
  }

  return (
    <SafeAreaProvider>
      <StatusBar
        barStyle={boot.kind === 'loading' ? 'light-content' : 'dark-content'}
      />
      {screen}
    </SafeAreaProvider>
  );
}

export default App;
