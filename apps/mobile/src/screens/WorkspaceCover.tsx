import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PrimaryButton, SandbeeLogo } from './Brand';
import { useReducedMotion } from './motion';
import { colors } from './theme';

export function WorkspaceCover({
  ready,
  origin,
  onRetry,
}: {
  ready: boolean;
  origin: string;
  onRetry: () => void;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const animation = Animated.timing(opacity, {
      toValue: 0,
      duration: reduced ? 0 : 200,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => animation.stop();
  }, [ready, reduced, opacity]);
  useEffect(() => {
    if (ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (state: string) => {
      clearTimeout(timer);
      if (state === 'active') timer = setTimeout(() => setSlow(true), 12_000);
    };
    schedule(AppState.currentState ?? 'unknown');
    const listener = AppState.addEventListener('change', schedule);
    return () => {
      clearTimeout(timer);
      listener.remove();
    };
  }, [ready]);
  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents={ready ? 'none' : 'auto'}
      style={[styles.cover, { opacity }]}
      accessibilityElementsHidden={ready}
      importantForAccessibility={ready ? 'no-hide-descendants' : 'auto'}
    >
      <View style={styles.content}>
        <SandbeeLogo size={76} />
        <Text style={styles.title}>Connecting to your POS</Text>
        <View style={styles.chip}>
          <Text style={styles.host}>{origin.replace(/^https?:\/\//, '')}</Text>
        </View>
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={styles.spinner}
        />
        <Text accessibilityLiveRegion="polite" style={styles.hint}>
          {slow
            ? 'Taking longer than usual. Check your connection.'
            : 'Getting your workspace ready…'}
        </Text>
        {slow && (
          <View style={styles.retry}>
            <PrimaryButton title="Try again" onPress={onRetry} />
          </View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  content: { width: '100%', maxWidth: 420, alignItems: 'center' },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 28,
  },
  chip: {
    borderRadius: 20,
    backgroundColor: colors.tint,
    paddingVertical: 10,
    paddingHorizontal: 18,
    marginTop: 16,
  },
  host: {
    color: colors.primaryPressed,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  spinner: { marginTop: 32 },
  hint: {
    color: colors.muted,
    fontSize: 15,
    lineHeight: 23,
    textAlign: 'center',
    marginTop: 16,
  },
  retry: { width: '100%', marginTop: 28 },
});
