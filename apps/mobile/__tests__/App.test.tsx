/**
 * @format
 */

import React from 'react';
import { NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// The real library is ESM-only and needs a native view; the address screen never mounts it.
jest.mock('react-native-webview', () => ({ WebView: () => null }));
// SafeAreaProvider renders nothing until the native side reports insets.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

// A cold Babel/Jest cache can take longer than the 5 s default on this machine.
const COLD_START_TIMEOUT_MS = 60_000;

type Stub = { getSavedOrigin: jest.Mock; clearOrigin: jest.Mock };

function textOf(root: ReactTestRenderer.ReactTestRenderer): string[] {
  return root.root
    .findAllByType(Text)
    .map(node => String(node.props.children).replace(/\s+/g, ' '));
}

test(
  'first run with no saved address asks for the POS address',
  async () => {
    const stub: Stub = {
      getSavedOrigin: jest.fn().mockResolvedValue(null),
      clearOrigin: jest.fn().mockResolvedValue(null),
    };
    (NativeModules as { PosPrinter?: Stub }).PosPrinter = stub;

    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<App />);
    });

    expect(stub.getSavedOrigin).toHaveBeenCalledTimes(1);
    expect(textOf(renderer)).toContain('POS address');
    expect(textOf(renderer)).toContain('Open POS');
  },
  COLD_START_TIMEOUT_MS,
);
