/**
 * @format
 */

import React from 'react';
import { AccessibilityInfo, DeviceEventEmitter, NativeModules } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { PAGE_DEAD_EVENT } from '../src/native/PosPrinter';
import { PosScreen } from '../src/screens/PosScreen';

// The 3D review gate (m-4): the print host's watchdog says a hidden page stopped answering (Kotlin's HostPage.DEAD_EVENT,
// emitted by the module); the POS screen must remount its WebView and ask the app to mount it while hidden. The real
// WebView needs a native view: a stand-in counts its mounts (a remount is a fresh one, by its key).
const mockWebView = { mounts: 0 };
jest.mock('react-native-webview', () => {
  const ReactActual = jest.requireActual('react');
  return {
    WebView: ReactActual.forwardRef(function FakeWebView() {
      ReactActual.useEffect(() => {
        mockWebView.mounts += 1;
      }, []);
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

test(
  "the watchdog's word remounts the page: a fresh WebView, mounted at once even while the app is hidden",
  async () => {
    const stub = {
      // The bridge token never arrives here: the page itself is not needed to prove the remount.
      newToken: jest.fn(() => new Promise(() => undefined)),
      mountWhileHidden: jest.fn().mockResolvedValue(null),
    };
    (NativeModules as { PosPrinter?: unknown }).PosPrinter = stub;
    let screen!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      screen = ReactTestRenderer.create(
        <PosScreen origin="https://cafe.example.com" onChangeUrl={() => undefined} />,
      );
    });
    expect(mockWebView.mounts).toBe(1);
    expect(PAGE_DEAD_EVENT).toBe('PosPageDead');
    await ReactTestRenderer.act(async () => {
      DeviceEventEmitter.emit(PAGE_DEAD_EVENT);
    });
    expect(stub.mountWhileHidden).toHaveBeenCalledTimes(1);
    expect(mockWebView.mounts).toBe(2);
    await ReactTestRenderer.act(async () => {
      screen.unmount();
    });
    DeviceEventEmitter.emit(PAGE_DEAD_EVENT);
    expect(stub.mountWhileHidden).toHaveBeenCalledTimes(1);
  },
  COLD_START_TIMEOUT_MS,
);
