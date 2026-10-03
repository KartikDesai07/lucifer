import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizePosUrl } from '../url';
import { PosPrinter } from '../native/PosPrinter';
import { PrimaryButton, SandbeeLogo } from './Brand';
import { Icon } from './Icon';
import { EMPHASIZED, MOTION, reducedMotionOnce } from './motion';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

export const SAVE_FAILED_ERROR =
  'The address could not be saved. Close the app and try again.';
type Props = { initialValue?: string; onSaved: (origin: string) => void };

/** The hint card's change, as in the Sandbee app (onboarding/ui/UrlSetupContent.kt): fade in from 97 %. */
const HINT_ENTER_SCALE = 0.97;

export function UrlScreen({ initialValue = '', onSaved }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  const hasError = error !== null;
  // The screen rises in once; the hint card fades and scales in whenever it switches between help and error.
  const enter = useRef(new Animated.Value(0)).current;
  const hint = useRef(new Animated.Value(1)).current;
  const still = useRef(true);
  useEffect(() => {
    let live = true;
    reducedMotionOnce().then(reduced => {
      if (!live) return;
      still.current = reduced;
      if (reduced) {
        enter.setValue(1);
        return;
      }
      Animated.timing(enter, { toValue: 1, duration: MOTION.LONG_MS, easing: EMPHASIZED, useNativeDriver: true }).start();
    });
    return () => {
      live = false;
    };
  }, [enter]);
  const firstHint = useRef(true);
  useEffect(() => {
    if (firstHint.current) {
      firstHint.current = false;
      return;
    }
    if (still.current) return;
    hint.setValue(0);
    Animated.timing(hint, { toValue: 1, duration: MOTION.MEDIUM_MS, easing: EMPHASIZED, useNativeDriver: true }).start();
  }, [hasError, hint]);

  async function submit() {
    if (submitting.current) return;
    const result = normalizePosUrl(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    submitting.current = true;
    setSaving(true);
    Keyboard.dismiss();
    try {
      await PosPrinter.saveOrigin(result.origin);
      onSaved(result.origin);
    } catch {
      setError(SAVE_FAILED_ERROR);
      setSaving(false);
      submitting.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.helpRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Help finding your POS address"
            style={styles.helpButton}
            onPress={() =>
              Alert.alert(
                'Find your POS address',
                'Type your workspace name (for example yourcafe), or the full web address you use to open your cafe’s POS. Ask your administrator if you do not have it.\n\nAfter signing in, open Printers to connect Bluetooth, USB OTG or a network printer.',
                [{ text: 'Got it' }],
              )
            }
          >
            <Icon name="help" color={colors.muted} size={26} />
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <Animated.View
            style={[
              styles.form,
              {
                opacity: enter,
                transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
              },
            ]}
          >
            <View style={styles.logo}>
              <SandbeeLogo />
            </View>
            <Text style={styles.title} accessibilityRole="header">
              Connect to your workspace
            </Text>
            <Text style={styles.subtitle}>
              Your cafe, orders and printers. All in one place.
            </Text>
            <Text style={styles.label}>POS address</Text>
            <View
              style={[
                styles.field,
                focused && styles.fieldFocused,
                error !== null && styles.fieldError,
              ]}
            >
              <View style={[styles.linkBadge, hasError && styles.linkBadgeError]}>
                <Icon name="workspace" color={hasError ? colors.error : colors.primary} size={18} />
              </View>
              <TextInput
                ref={input}
                style={styles.input}
                value={value}
                onChangeText={text => {
                  setValue(text);
                  setError(null);
                }}
                placeholder="yourcafe or yourcafe.sandbee.in"
                placeholderTextColor={colors.muted}
                accessibilityLabel="POS address"
                accessibilityHint="Type your workspace name, or the full web address of your cafe's POS"
                editable={!saving}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                maxLength={2048}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={submit}
                selectionColor={colors.primary}
              />
              {value.length > 0 && !saving && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear POS address"
                  style={styles.clear}
                  onPress={() => {
                    setValue('');
                    setError(null);
                    input.current?.focus();
                  }}
                >
                  <Icon name="clear" color={hasError ? colors.error : colors.muted} size={22} />
                </Pressable>
              )}
            </View>
            <Animated.View
              style={[
                styles.hint,
                hasError && styles.hintError,
                {
                  opacity: hint,
                  transform: [{ scale: hint.interpolate({ inputRange: [0, 1], outputRange: [HINT_ENTER_SCALE, 1] }) }],
                },
              ]}
            >
              <View style={[styles.hintBadge, hasError && styles.hintBadgeError]}>
                <Icon name={hasError ? 'error' : 'info'} color="#ffffff" size={16} />
              </View>
              <View style={styles.hintCopy}>
                <Text style={[styles.hintTitle, hasError && styles.errorText]}>
                  {hasError ? 'Check the address' : 'Your workspace'}
                </Text>
                <Text
                  accessibilityRole={hasError ? 'alert' : undefined}
                  accessibilityLiveRegion="polite"
                  style={[styles.hintBody, hasError && styles.errorText]}
                >
                  {error ??
                    'Type your workspace name, or the full address shared by your administrator. We’ll remember it for next time.'}
                </Text>
              </View>
            </Animated.View>
            <View style={styles.action}>
              <PrimaryButton
                title={saving ? 'Connecting…' : 'Open POS'}
                accessibilityLabel="Open POS"
                onPress={submit}
                busy={saving}
              />
            </View>
            <Text style={styles.footer}>Bluetooth · USB OTG · Wi-Fi / LAN</Text>
            <Text style={styles.powered}>Sandbee POS</Text>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  helpRow: { alignItems: 'flex-end', paddingHorizontal: 12 },
  helpButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: SCREEN_PADDING,
    paddingBottom: 32,
    alignItems: 'center',
  },
  form: { width: '100%', maxWidth: 480 },
  logo: { alignItems: 'center', marginTop: 12, marginBottom: 28 },
  title: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 30,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.muted,
    marginBottom: 8,
  },
  field: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 14,
    paddingLeft: 14,
  },
  fieldFocused: { borderColor: colors.primary },
  fieldError: { borderColor: colors.error },
  linkBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  linkBadgeError: { backgroundColor: colors.errorSurface },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 54,
    paddingVertical: 12,
    paddingRight: 12,
    color: colors.text,
    fontSize: 16,
  },
  clear: {
    width: MIN_TOUCH_TARGET,
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: colors.tint,
    borderRadius: 14,
    marginTop: 14,
    minHeight: 84,
  },
  hintError: { backgroundColor: colors.errorSurface },
  hintBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBadgeError: { backgroundColor: colors.error },
  hintCopy: { flex: 1, minWidth: 0 },
  hintTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  hintBody: { fontSize: 13, lineHeight: 19, color: colors.muted },
  errorText: { color: colors.error },
  action: { marginTop: 28 },
  footer: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 13,
    marginTop: 28,
  },
  powered: {
    textAlign: 'center',
    color: colors.muted,
    fontSize: 12,
    marginTop: 10,
  },
});
