import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from './theme';
import { Icon } from './Icon';
import { EMPHASIZED, MOTION, reducedMotionOnce, useReducedMotion } from './motion';

const logo = require('../assets/sandbee-logo.png');

export function SandbeeLogo({
  size = 92,
  light = false,
}: {
  size?: number;
  light?: boolean;
}) {
  return (
    <Image
      source={logo}
      resizeMode="contain"
      accessibilityLabel="Sandbee"
      style={[{ width: size, height: size }, light ? styles.logoLight : styles.logoDark]}
    />
  );
}

const WAVE_CYCLE_MS = 4200;

/** One water layer: how high it sits, how far and which way it sways, and how strong its colour is. */
const WAVES = [
  { bottom: -150, sway: 34, opacity: 0.2 },
  { bottom: -120, sway: -26, opacity: 0.3 },
  { bottom: -92, sway: 20, opacity: 0.42 },
];

/** The Sandbee app's splash (onboarding/ui/SplashContent.kt): a soft glow, rolling water, and the logo and
 *  copy revealed with the emphasized curve. Native-driver animations only; still when animations are off. */
export function BootScreen() {
  const reveal = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let live = true;
    let running: Animated.CompositeAnimation | null = null;
    reducedMotionOnce().then(reduced => {
      if (!live) return;
      if (reduced) {
        reveal.setValue(1);
        return;
      }
      running = Animated.parallel([
        Animated.timing(reveal, {
          toValue: 1,
          duration: MOTION.LONG_MS,
          delay: 120,
          easing: EMPHASIZED,
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(wave, { toValue: 1, duration: WAVE_CYCLE_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
            Animated.timing(wave, { toValue: 0, duration: WAVE_CYCLE_MS / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          ]),
        ),
      ]);
      running.start();
    });
    return () => {
      live = false;
      running?.stop();
    };
  }, [reveal, wave]);
  const logoScale = reveal.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const rise = reveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  return (
    <View style={styles.boot}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={[styles.glow, styles.glowOuter]} />
        <View style={[styles.glow, styles.glowInner]} />
        {WAVES.map(layer => (
          <Animated.View
            key={layer.bottom}
            style={[
              styles.wave,
              {
                bottom: layer.bottom,
                opacity: layer.opacity,
                transform: [{ translateX: wave.interpolate({ inputRange: [0, 1], outputRange: [-layer.sway, layer.sway] }) }],
              },
            ]}
          />
        ))}
      </View>
      <Animated.View style={{ opacity: reveal, transform: [{ scale: logoScale }] }}>
        <SandbeeLogo size={128} light />
      </Animated.View>
      <Animated.View style={[styles.bootCopy, { opacity: reveal, transform: [{ translateY: rise }] }]}>
        <Text style={styles.bootTitle}>Sandbee POS</Text>
        <Text style={styles.tagline}>Your counter. Connected.</Text>
        <ActivityIndicator
          style={styles.spinner}
          color={colors.primary}
          accessibilityLabel="Starting your POS"
        />
        <Text style={styles.loading}>Loading…</Text>
      </Animated.View>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  busy = false,
  disabled = false,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const blocked = disabled || busy;
  const press = (toValue: number) => {
    Animated.timing(scale, {
      toValue,
      duration: reduced ? 0 : 100,
      useNativeDriver: true,
      isInteraction: false,
    }).start();
  };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        accessibilityState={{ disabled: blocked, busy }}
        disabled={blocked}
        onPress={onPress}
        onPressIn={() => press(0.98)}
        onPressOut={() => press(1)}
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          blocked && styles.disabled,
        ]}
      >
        {busy && <ActivityIndicator color="#ffffff" />}
        <Text style={styles.buttonText}>{title}</Text>
        {!busy && <Icon name="arrow-forward" color="#ffffff" size={20} />}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  logoLight: { tintColor: '#ffffff' },
  logoDark: { tintColor: colors.navy },
  boot: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  glow: { position: 'absolute', backgroundColor: colors.primary },
  glowOuter: { width: 560, height: 560, borderRadius: 280, top: -260, left: -240, opacity: 0.08 },
  glowInner: { width: 320, height: 320, borderRadius: 160, top: -140, left: -120, opacity: 0.1 },
  wave: {
    position: 'absolute',
    left: '-60%',
    width: '220%',
    height: 260,
    borderTopLeftRadius: 900,
    borderTopRightRadius: 900,
    backgroundColor: colors.primary,
  },
  bootCopy: { alignItems: 'center' },
  bootTitle: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '700',
    marginTop: 20,
  },
  tagline: { color: 'rgba(255,255,255,0.72)', fontSize: 16, marginTop: 6 },
  spinner: { marginTop: 44 },
  loading: { color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 14 },
  button: {
    minHeight: 54,
    borderRadius: 28,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    gap: 10,
  },
  pressed: { backgroundColor: colors.primaryPressed },
  disabled: { backgroundColor: colors.disabled },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
