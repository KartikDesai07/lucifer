// Curated plain-English text per error code. The page only ever sees these
// strings, never a native exception message (those can carry device details).

import type { NativeErrorCode } from './protocol';

export const NATIVE_ERROR_MESSAGES: Record<NativeErrorCode, string> = {
  NOT_CONNECTED: 'The printer is not connected.',
  WRITE_FAILED: 'The slip could not be sent to the printer.',
  TOO_LARGE: 'This slip is too large to print.',
  BUSY: 'The printer is busy. Try again in a moment.',
  TIMEOUT: 'The printer took too long to answer.',
  UNAUTHORIZED: 'Allow Bluetooth or nearby devices for this app first.',
  BLUETOOTH_OFF: 'Bluetooth is turned off.',
  UNSUPPORTED: 'This is not available in the POS app on this device.',
  BAD_REQUEST: 'The app could not understand that request.',
  LOCATION_OFF: 'Turn on Location so this tablet can find nearby printers.',
};
