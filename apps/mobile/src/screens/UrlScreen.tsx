// Asks for the POS address once and saves it. Plain-English errors only.

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { normalizePosUrl } from '../url';
import { PosPrinter } from '../native/PosPrinter';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

export const SAVE_FAILED_ERROR =
  'The address could not be saved. Close the app and try again.';

type Props = {
  initialValue?: string;
  onSaved: (origin: string) => void;
};

export function UrlScreen({ initialValue = '', onSaved }: Props) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (saving) {
      return;
    }
    const result = normalizePosUrl(value);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await PosPrinter.saveOrigin(result.origin);
      onSaved(result.origin);
    } catch {
      setError(SAVE_FAILED_ERROR);
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title} accessibilityRole="header">
            POS address
          </Text>
          <Text style={styles.help}>
            Enter the web address of your POS. It looks like
            https://your-pos.example.com
          </Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={text => {
              setValue(text);
              setError(null);
            }}
            placeholder="https://your-pos.example.com"
            placeholderTextColor={colors.muted}
            accessibilityLabel="POS address"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {error !== null && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <Pressable
            style={[styles.button, saving && styles.buttonBusy]}
            onPress={submit}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Open POS"
          >
            <Text style={styles.buttonText}>
              {saving ? 'Opening...' : 'Open POS'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, justifyContent: 'center', padding: SCREEN_PADDING },
  title: { fontSize: 28, fontWeight: '700', color: colors.text },
  help: { fontSize: 16, color: colors.muted, marginTop: 8, marginBottom: 20 },
  input: {
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
  },
  error: { fontSize: 15, color: colors.error, marginTop: 12 },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    marginTop: 20,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { fontSize: 17, fontWeight: '600', color: colors.primaryText },
});
