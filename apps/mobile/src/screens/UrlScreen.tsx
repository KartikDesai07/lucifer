import { useRef, useState, type ComponentRef } from 'react';
import {
  Alert,
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
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

export const SAVE_FAILED_ERROR =
  'The address could not be saved. Close the app and try again.';
type Props = { initialValue?: string; onSaved: (origin: string) => void };

export function UrlScreen({ initialValue = '', onSaved }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);

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
                'Enter the same web address you use to open your cafe’s POS. Ask your administrator if you do not have it.\n\nAfter signing in, open Printers to connect Bluetooth, USB OTG or a network printer.',
                [{ text: 'Got it' }],
              )
            }
          >
            <Text style={styles.helpIcon}>?</Text>
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={styles.form}>
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
              <View style={styles.linkBadge}>
                <Text style={styles.linkIcon} accessible={false}>
                  ↗
                </Text>
              </View>
              <TextInput
                ref={input}
                style={styles.input}
                value={value}
                onChangeText={text => {
                  setValue(text);
                  setError(null);
                }}
                placeholder="your-pos.example.com"
                placeholderTextColor={colors.muted}
                accessibilityLabel="POS address"
                accessibilityHint="Enter the web address supplied for your cafe"
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
                  <Text style={styles.clearText}>×</Text>
                </Pressable>
              )}
            </View>
            <View style={[styles.hint, error !== null && styles.hintError]}>
              <Text
                style={[styles.hintTitle, error !== null && styles.errorText]}
              >
                {error === null
                  ? 'Your workspace address'
                  : 'Check the address'}
              </Text>
              <Text
                accessibilityRole={error !== null ? 'alert' : undefined}
                accessibilityLiveRegion="polite"
                style={[styles.hintBody, error !== null && styles.errorText]}
              >
                {error ??
                  'Use the address shared by your administrator. We’ll remember it for next time.'}
              </Text>
            </View>
            <View style={styles.action}>
              <PrimaryButton
                title={saving ? 'Connecting…' : 'Open POS'}
                accessibilityLabel="Open POS"
                onPress={submit}
                busy={saving}
              />
            </View>
            <Text style={styles.footer}>Bluetooth · USB OTG · Wi-Fi / LAN</Text>
            <Text style={styles.powered}>POS Software by Sandbee</Text>
          </View>
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
  helpIcon: {
    color: colors.muted,
    borderColor: colors.muted,
    borderWidth: 1.5,
    borderRadius: 12,
    width: 24,
    height: 24,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '600',
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
  linkIcon: { color: colors.primary, fontSize: 20, fontWeight: '600' },
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
  clearText: { color: colors.muted, fontSize: 26 },
  hint: {
    padding: 16,
    backgroundColor: colors.tint,
    borderRadius: 14,
    marginTop: 14,
    minHeight: 84,
  },
  hintError: { backgroundColor: colors.errorSurface },
  hintTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryPressed,
    marginBottom: 4,
  },
  hintBody: { fontSize: 13, lineHeight: 20, color: colors.primaryPressed },
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
