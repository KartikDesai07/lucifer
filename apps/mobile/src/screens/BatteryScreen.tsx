// Phase 3 Session 3D (spec §9.5): the battery checklist, opened from the POS page's More options (app.battery). It
// shows over the POS (which keeps printing underneath): this phone's steps first, and links into the phone's settings
// where Android allows them. Local only: no request. Back or Done closes it.

import { useEffect, useState } from 'react';
import {
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  BATTERY_INTRO,
  batteryBrandOf,
  batterySectionsFor,
  hasAutostartScreen,
  type BatteryBrand,
} from '../battery-steps';
import { PosPrinter, type BatterySettingsKind } from '../native/PosPrinter';
import { PrimaryButton } from './Brand';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

const noop = () => undefined;

type Props = { onDone: () => void };

export function BatteryScreen({ onDone }: Props) {
  const [brand, setBrand] = useState<BatteryBrand>('other');
  const [unrestricted, setUnrestricted] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    PosPrinter.batteryInfo().then(info => {
      if (!cancelled) {
        setBrand(batteryBrandOf(info.brand));
        setUnrestricted(info.unrestricted === true);
      }
    }, noop);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onDone();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onDone]);

  const open = (kind: BatterySettingsKind) => {
    PosPrinter.openBatterySettings(kind).catch(noop);
  };

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title} accessibilityRole="header">
          Keep printing on with the screen off
        </Text>
        <Text style={styles.help}>{BATTERY_INTRO}</Text>
        {unrestricted === true ? (
          <Text style={styles.ok}>
            Android lets this app run with no battery limit.
          </Text>
        ) : null}
        <PrimaryButton
          title="Battery settings for this app"
          onPress={() => open('battery')}
        />
        {hasAutostartScreen(brand) ? (
          <LinkButton
            title="Autostart settings"
            onPress={() => open('autostart')}
          />
        ) : null}
        <LinkButton title="App info" onPress={() => open('app')} />
        {batterySectionsFor(brand).map(section => (
          <View key={section.brand} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.steps.map((step, index) => (
              <Text key={step} style={styles.step}>
                {index + 1 + '. ' + step}
              </Text>
            ))}
          </View>
        ))}
        <PrimaryButton title="Done" onPress={onDone} />
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkButton({
  title,
  onPress,
}: {
  title: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={styles.link}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
  },
  content: { padding: SCREEN_PADDING },
  title: { fontSize: 24, fontWeight: '600', color: colors.text },
  help: {
    fontSize: 16,
    lineHeight: 24,
    color: colors.muted,
    marginTop: 8,
    marginBottom: 16,
  },
  ok: { fontSize: 15, color: colors.text, marginBottom: 12 },
  link: {
    minHeight: MIN_TOUCH_TARGET,
    marginTop: 8,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: { fontSize: 16, fontWeight: '600', color: colors.primary },
  section: {
    marginTop: 20,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  step: { fontSize: 15, lineHeight: 22, color: colors.text, marginTop: 4 },
});
