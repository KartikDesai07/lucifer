// Shown when the POS page cannot be opened. With onAutoRetry it also tries
// again by itself, but only while the app is on screen (no timer runs, and no
// reload fires, while the app is in the background) and only up to a cap.

import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canAutoRetry, RETRY_DELAY_MS } from './auto-retry';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

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
      <View style={styles.content}>
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
        <Pressable
          style={styles.primary}
          onPress={onRetry}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>Try again</Text>
        </Pressable>
        <Pressable
          style={styles.secondary}
          onPress={onChangeAddress}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Change address</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', padding: SCREEN_PADDING },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  help: { fontSize: 16, color: colors.muted, marginTop: 8, marginBottom: 24 },
  auto: { fontSize: 14, color: colors.muted, marginBottom: 16 },
  primary: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { fontSize: 17, fontWeight: '600', color: colors.primaryText },
  secondary: {
    minHeight: MIN_TOUCH_TARGET,
    marginTop: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { fontSize: 17, fontWeight: '600', color: colors.text },
});
