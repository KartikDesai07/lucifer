/**
 * @format
 */

import React from 'react';
import { AccessibilityInfo, AppState, NativeModules, Text } from 'react-native';
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
    const listen = AppState.addEventListener as jest.Mock;
    const onChange = listen.mock.calls[listen.mock.calls.length - 1][1] as (
      state: string,
    ) => void;
    await ReactTestRenderer.act(async () => {
      onChange('background');
    });
    expect(textOf(screen)).not.toContain('Update available');
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
  },
  COLD_START_TIMEOUT_MS,
);
