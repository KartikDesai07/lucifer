import React from 'react';
import { AccessibilityInfo, NativeModules, Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { UrlScreen } from '../src/screens/UrlScreen';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

// The test renderer cannot run native-driver animations: answer "animations off".
jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);

test('an invalid public HTTP address is explained without saving it', async () => {
  const saveOrigin = jest.fn();
  NativeModules.PosPrinter = { saveOrigin };
  const onSaved = jest.fn();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(
      <UrlScreen initialValue="http://cafe.example.com" onSaved={onSaved} />,
    );
  });
  await ReactTestRenderer.act(async () => {
    await screen.root
      .findByProps({ accessibilityLabel: 'Open POS' })
      .props.onPress();
  });
  expect(saveOrigin).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
  expect(
    screen.root
      .findAllByType(Text)
      .some(node => node.props.accessibilityRole === 'alert'),
  ).toBe(true);
  await ReactTestRenderer.act(async () => {
    screen.unmount();
  });
});

test('rapid submits save once, lock the input, and permit retry after a save failure', async () => {
  let fail!: (error: Error) => void;
  const saveOrigin = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValue(null);
  NativeModules.PosPrinter = { saveOrigin };
  const onSaved = jest.fn();
  let screen!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    screen = ReactTestRenderer.create(
      <UrlScreen initialValue="cafe.example.com" onSaved={onSaved} />,
    );
  });
  let first!: Promise<void>;
  await ReactTestRenderer.act(async () => {
    const submit = screen.root.findByProps({ accessibilityLabel: 'Open POS' })
      .props.onPress;
    first = submit();
    await submit();
  });
  expect(saveOrigin).toHaveBeenCalledTimes(1);
  expect(
    screen.root.findByProps({ accessibilityLabel: 'POS address' }).props
      .editable,
  ).toBe(false);
  await ReactTestRenderer.act(async () => {
    fail(new Error('storage unavailable'));
    await first;
  });
  expect(
    screen.root.findByProps({ accessibilityLabel: 'POS address' }).props
      .editable,
  ).toBe(true);
  expect(onSaved).not.toHaveBeenCalled();
  await ReactTestRenderer.act(async () => {
    await screen.root
      .findByProps({ accessibilityLabel: 'Open POS' })
      .props.onPress();
  });
  expect(saveOrigin).toHaveBeenCalledTimes(2);
  expect(onSaved).toHaveBeenCalledWith('https://cafe.example.com');
  await ReactTestRenderer.act(async () => {
    screen.unmount();
  });
});
