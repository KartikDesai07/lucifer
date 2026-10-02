// Runtime permission prompts. Android shows them; the Kotlin side only checks
// the grants. Bluetooth: API 31+ needs CONNECT + SCAN, API 30 and older needs
// location. Notifications: API 33+ only.

import { PermissionsAndroid, Platform } from 'react-native';
import type { NativePermissionKind } from '../bridge/protocol';

const API_BLUETOOTH_RUNTIME = 31;
const API_NOTIFICATIONS_RUNTIME = 33;
const { PERMISSIONS, RESULTS } = PermissionsAndroid;

async function requestBluetooth(api: number): Promise<boolean> {
  if (api >= API_BLUETOOTH_RUNTIME) {
    const results = await PermissionsAndroid.requestMultiple([
      PERMISSIONS.BLUETOOTH_CONNECT,
      PERMISSIONS.BLUETOOTH_SCAN,
    ]);
    return (
      results[PERMISSIONS.BLUETOOTH_CONNECT] === RESULTS.GRANTED &&
      results[PERMISSIONS.BLUETOOTH_SCAN] === RESULTS.GRANTED
    );
  }
  const result = await PermissionsAndroid.request(
    PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return result === RESULTS.GRANTED;
}

async function requestNotifications(api: number): Promise<boolean> {
  if (api < API_NOTIFICATIONS_RUNTIME) {
    return true;
  }
  const result = await PermissionsAndroid.request(
    PERMISSIONS.POST_NOTIFICATIONS,
  );
  return result === RESULTS.GRANTED;
}

// Resolves true only when everything the kind needs is granted. Never throws.
export async function requestPermission(
  kind: NativePermissionKind,
): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const api = Number(Platform.Version);
  try {
    return kind === 'bluetooth'
      ? await requestBluetooth(api)
      : await requestNotifications(api);
  } catch {
    return false;
  }
}
