// Shown when the POS page cannot be opened. With onAutoRetry it also tries
// again by itself, but only while the app is on screen (no timer runs, and no
// reload fires, while the app is in the background) and only up to a cap.

import { useEffect, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canAutoRetry, RETRY_DELAY_MS } from './auto-retry';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';
import { PrimaryButton, SandbeeLogo } from './Brand';

// AppState.currentState can be null before the first native report.
const UNKNOWN_APP_STATE = 'unknown';

type Props = {
  onRetry: () => void;
  onChangeAddress: () => void;
  // Automatic retries already spent, and the (stable) callback that runs one.
  autoRetriesUsed?: number;
  onAutoRetry?: () => void;
};

export function LoadErrorScreen({
  onRetry,
  onChangeAddress,
  autoRetriesUsed = 0,
  onAutoRetry,
}: Props) {
  const [appState, setAppState] = useState<string>(
    AppState.currentState ?? UNKNOWN_APP_STATE,
  );
  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    setAppState(AppState.currentState ?? UNKNOWN_APP_STATE);
    return () => subscription.remove();
  }, []);

  const waiting =
    onAutoRetry !== undefined && canAutoRetry(autoRetriesUsed, appState);
  useEffect(() => {
    if (!waiting || onAutoRetry === undefined) {
      return undefined;
    }
    const timer = setTimeout(onAutoRetry, RETRY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [waiting, onAutoRetry, autoRetriesUsed]);

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.logo}><SandbeeLogo size={72} /></View>
          <View style={styles.errorBadge}><Text accessible={false} style={styles.badge}>!</Text></View>
          <Text style={styles.title} accessibilityRole="header">
            Could not open the POS
          </Text>
          <Text style={styles.help}>
            Check that this device is online and the address is right, then try
            again.
          </Text>
          {waiting ? (
            <Text style={styles.auto}>The app is trying again by itself.</Text>
          ) : null}
          <PrimaryButton title="Try again" onPress={onRetry} />
          <Pressable
            style={styles.secondary}
            onPress={onChangeAddress}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Change address</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SCREEN_PADDING,
  },
  card: {
    width: '100%',
    maxWidth: 420,
  },
  logo: { alignItems: 'center', marginBottom: 28 },
  errorBadge: { alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: colors.errorSurface, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  badge: { color: colors.error, fontSize: 28, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '600', color: colors.text, textAlign: 'center' },
  help: { fontSize: 16, lineHeight: 24, color: colors.muted, marginTop: 8, marginBottom: 24, textAlign: 'center' },
  auto: { fontSize: 14, color: colors.muted, marginBottom: 16, textAlign: 'center' },
  secondary: {
    minHeight: MIN_TOUCH_TARGET,
    marginTop: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 16, fontWeight: '600', color: colors.primary },
});
