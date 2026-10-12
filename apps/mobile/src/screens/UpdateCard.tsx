// Native apps 2.0 (spec §6.3): the update card, a sheet over the POS shown only at an app open (the Kotlin module
// decides when; update-card.ts keeps what it shows). Install starts Android's installer; Later, or Back, closes it until
// the next open. The POS keeps working and printing underneath.

import { useCallback, useEffect, useReducer, useState } from 'react';
import {
  AppState,
  BackHandler,
  DeviceEventEmitter,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  PosUpdate,
  UPDATE_CARD_EVENT,
  UPDATE_RESULT_EVENT,
  type UpdateCardInfo,
} from '../native/PosUpdate';
import {
  asCardInfo,
  CARD_START,
  reduceCard,
  type CardState,
} from '../update-card';
import { PrimaryButton, SandbeeLogo } from './Brand';
import { colors, MIN_TOUCH_TARGET, SCREEN_PADDING } from './theme';

const noop = () => undefined;

/**
 * The POS screen's update card: asked for when the screen mounts in view and each time the app comes back into view
 * (the app hands a card out at most once per open, so asking again is harmless); a card that waited for a print
 * arrives as an event, and a failed or cancelled install as another.
 */
export function useUpdateCard() {
  const [state, dispatch] = useReducer(reduceCard, CARD_START, start => ({
    ...start,
    active: AppState.currentState === 'active',
  }));
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    let live = true;
    const offer = (value: unknown) => {
      const info = asCardInfo(value);
      if (live && info !== null) {
        dispatch({ type: 'card', info });
      }
    };
    const take = () => {
      PosUpdate.takeCard().then(offer, noop);
    };
    if (AppState.currentState === 'active') {
      take();
    }
    const appState = AppState.addEventListener('change', next => {
      dispatch({ type: 'appState', state: next });
      if (next === 'active') {
        take();
      }
    });
    const card = DeviceEventEmitter.addListener(UPDATE_CARD_EVENT, offer);
    const result = DeviceEventEmitter.addListener(UPDATE_RESULT_EVENT, () =>
      dispatch({ type: 'installFailed' }),
    );
    return () => {
      live = false;
      appState.remove();
      card.remove();
      result.remove();
    };
  }, []);

  const install = useCallback(() => {
    dispatch({ type: 'installing' });
    setInstalling(true);
    PosUpdate.install().then(answer => {
      setInstalling(false);
      dispatch({ type: 'install', answer });
    });
  }, []);
  const later = useCallback(() => {
    PosUpdate.later();
    dispatch({ type: 'later' });
  }, []);

  return { state, installing, install, later };
}

export const UPDATE_FIRST_TIME_NOTE =
  'The first time, Android asks you to allow installs from Sandbee POS.';
export const UPDATE_PERMISSION_NOTE =
  'Allow Sandbee POS to install apps, then tap Install again.';
export const UPDATE_FAILED_NOTE =
  'The update could not be installed. It will be offered again next time.';

type Props = {
  info: UpdateCardInfo;
  note: CardState['note'];
  busy: boolean;
  onInstall: () => void;
  onLater: () => void;
};

function noteText(note: CardState['note']): string {
  if (note === 'permission') {
    return UPDATE_PERMISSION_NOTE;
  }
  if (note === 'failed') {
    return UPDATE_FAILED_NOTE;
  }
  return UPDATE_FIRST_TIME_NOTE;
}

export function UpdateCard({ info, note, busy, onInstall, onLater }: Props) {
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        onLater();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onLater]);

  return (
    <View style={styles.scrim}>
      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <View accessibilityViewIsModal style={styles.content}>
          <SandbeeLogo size={56} />
          <Text style={styles.title} accessibilityRole="header">
            Update available
          </Text>
          <Text style={styles.body}>
            {'Sandbee POS ' + info.version + ' is ready to install.'}
          </Text>
          {info.notes !== '' ? (
            <Text style={styles.notes}>{info.notes}</Text>
          ) : null}
          <Text style={note === 'none' ? styles.hint : styles.warn}>
            {noteText(note)}
          </Text>
          <PrimaryButton title="Install" onPress={onInstall} busy={busy} />
          <Pressable
            style={styles.later}
            onPress={onLater}
            accessibilityRole="button"
          >
            <Text style={styles.laterText}>Later</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(11, 18, 32, 0.45)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  content: { padding: SCREEN_PADDING, gap: 12 },
  title: { fontSize: 22, fontWeight: '600', color: colors.text },
  body: { fontSize: 16, lineHeight: 22, color: colors.text },
  notes: { fontSize: 15, lineHeight: 22, color: colors.muted },
  hint: { fontSize: 14, lineHeight: 20, color: colors.muted },
  warn: { fontSize: 14, lineHeight: 20, color: colors.error },
  later: {
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterText: { fontSize: 16, fontWeight: '600', color: colors.primary },
});
