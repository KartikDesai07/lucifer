/**
 * POS Software mobile shell: loads the POS from one saved address.
 *
 * @format
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PosPrinter } from './src/native/PosPrinter';
import { LoadErrorScreen } from './src/screens/LoadErrorScreen';
import { PosScreen } from './src/screens/PosScreen';
import { colors } from './src/screens/theme';
import { UrlScreen } from './src/screens/UrlScreen';
import { normalizePosUrl } from './src/url';

type Boot =
  | { kind: 'loading' }
  | { kind: 'url'; initial: string }
  | { kind: 'pos'; origin: string }
  | { kind: 'error' };

const noop = () => undefined;

function App() {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
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
    PosPrinter.clearOrigin()
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
    screen = (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      {screen}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});

export default App;
