/**
 * @format
 */

import React from 'react';
import {
  AccessibilityInfo,
  AppState,
  DeviceEventEmitter,
  NativeModules,
  Text,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PosScreen } from '../src/screens/PosScreen';

// Native apps 2.0 (spec §6.3): the POS screen takes the update card at an app open and shows it over the POS; Later
// closes it and tells the app; the app going to the background drops a card nobody took. The WebView needs a native
// view: a stand-in that renders nothing.
jest.mock('react-native-webview', () => {
  const ReactActual = jest.requireActual('react');
  return {
    WebView: ReactActual.forwardRef(function FakeWebView() {
      return null;
    }),
  };
});
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

const COLD_START_TIMEOUT_MS = 60_000;

function textOf(screen: ReactTestRenderer.ReactTestRenderer): string {
  return screen.root
    .findAllByType(Text)
    .map(t => [t.props.children].flat().join(''))
    .join('\n');
}

/** The nearest pressable around the text [label]. */
function pressableWith(
  screen: ReactTestRenderer.ReactTestRenderer,
  label: string,
): ReactTestRenderer.ReactTestInstance | null {
  const text = screen.root
    .findAllByType(Text)
    .find(t => t.props.children === label);
  let node = text?.parent ?? null;
  while (node !== null && typeof node.props.onPress !== 'function') {
    node = node.parent;
  }
  return node;
}

function stubs() {
  // The bridge token never arrives: the page itself is not needed for the card.
  (NativeModules as { PosPrinter?: unknown }).PosPrinter = {
    newToken: jest.fn(() => new Promise(() => undefined)),
  };
  const update = {
    takeCard: jest
      .fn()
      .mockResolvedValue({ version: '2.0.1', notes: 'Faster printing.' }),
    install: jest.fn().mockResolvedValue('started'),
    later: jest.fn(),
  };
  (NativeModules as { PosUpdate?: unknown }).PosUpdate = update;
  (AppState as { currentState: unknown }).currentState = 'active';
  // Each test's screen registers its own listeners; an earlier test's are not this screen's.
  (AppState.addEventListener as jest.Mock).mockClear();
  return update;
}

test(
  'the update card shows at an app open over the POS, and Later closes it',
  async () => {
    const update = stubs();
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(update.takeCard).toHaveBeenCalledTimes(1);
    expect(textOf(screen)).toContain('Update available');
    expect(textOf(screen)).toContain('Sandbee POS 2.0.1 is ready to install.');
    expect(textOf(screen)).toContain('Faster printing.');
    const later = pressableWith(screen, 'Later');
    expect(later).not.toBeNull();
    await ReactTestRenderer.act(async () => {
      later?.props.onPress();
    });
    expect(update.later).toHaveBeenCalledTimes(1);
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);

test(
  'the app going to the background drops the card',
  async () => {
    stubs();
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(textOf(screen)).toContain('Update available');
    // The N2 review gate (the review's m-7): every AppState listener of this screen hears the change, as on a phone,
    // so the test does not depend on which listener was added last.
    const listen = AppState.addEventListener as jest.Mock;
    const onChanges = listen.mock.calls
      .filter(call => call[0] === 'change')
      .map(call => call[1] as (state: string) => void);
    expect(onChanges.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => {
      for (const onChange of onChanges) {
        onChange('background');
      }
    });
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);

test(
  "Cancel in Android's install dialog closes the card like Later",
  async () => {
    // The N2 review gate (the review's m-4, the owner's ruling of 2026-10-13): the app's answer to a Cancel.
    stubs();
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(textOf(screen)).toContain('Update available');
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit('PosUpdateResult', { ok: false, cancelled: true });
    });
    expect(textOf(screen)).not.toContain('Update available');
    expect(textOf(screen)).not.toContain('could not be installed');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);
