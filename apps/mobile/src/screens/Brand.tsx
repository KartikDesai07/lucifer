import { useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors } from './theme';
import { useReducedMotion } from './motion';

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
      style={{
        width: size,
        height: size,
        tintColor: light ? '#ffffff' : colors.navy,
      }}
    />
  );
}

export function BootScreen() {
  return (
    <View style={styles.boot}>
      <SandbeeLogo size={128} light />
      <Text style={styles.bootTitle}>Sandbee POS</Text>
      <Text style={styles.tagline}>Your counter. Connected.</Text>
      <ActivityIndicator
        style={styles.spinner}
        color="#6d9bff"
        accessibilityLabel="Starting your POS"
      />
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
        {!busy && (
          <Text accessible={false} style={styles.arrow}>
            →
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  bootTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
    marginTop: 20,
  },
  tagline: { color: '#9aa7bd', fontSize: 16, marginTop: 8 },
  spinner: { marginTop: 36 },
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
  arrow: { color: '#ffffff', fontSize: 22, lineHeight: 24 },
});
