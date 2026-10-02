// Typed wrapper around the Kotlin module NativeModules.PosPrinter. Every call
// returns a Promise; when the module is missing (iOS, tests) every call
// rejects with code UNSUPPORTED instead of throwing synchronously.

import { NativeModules } from 'react-native';
import type { NativePort } from '../bridge/router';
import type {
  NativePermissionKind,
  NativePlatform,
  NativePrinter,
  PrinterStatus,
} from '../bridge/protocol';
import { requestPermission } from './permissions';

export interface PosPrinterModule {
  getSavedOrigin(): Promise<string | null>;
  saveOrigin(origin: string): Promise<null>;
  clearOrigin(): Promise<null>;
  newToken(): Promise<string>;
  appInfo(): Promise<{
    appVersion: string;
    platform: NativePlatform;
    transports: string[];
  }>;
  getStatus(): Promise<PrinterStatus>;
  listPrinters(scan: boolean): Promise<{ printers: NativePrinter[] }>;
  selectPrinter(id: string): Promise<PrinterStatus>;
  selectTcp(host: string, port: number): Promise<PrinterStatus>;
  reconnect(): Promise<PrinterStatus>;
  forget(): Promise<PrinterStatus>;
  print(base64: string): Promise<{ bytes: number }>;
  refreshStatus(): Promise<PrinterStatus>;
  enableBluetooth(): Promise<{ on: boolean }>;
  setHostActive(active: boolean, label: string): Promise<{ active: boolean }>;
  moveTaskToBack(): Promise<null>;
  attachWebView(
    tag: number,
    script: string,
    origin: string,
  ): Promise<{ documentStart: boolean }>;
  deliverScript(script: string): Promise<null>;
}

type MethodName = keyof PosPrinterModule;

function unsupported(): Error {
  return Object.assign(new Error('The POS app printing module is missing.'), {
    code: 'UNSUPPORTED',
  });
}

// Looked up per call so a late-registered or test-stubbed module is found.
function call<M extends MethodName>(
  name: M,
  ...args: Parameters<PosPrinterModule[M]>
): ReturnType<PosPrinterModule[M]> {
  const module = (NativeModules as { PosPrinter?: Partial<PosPrinterModule> })
    .PosPrinter;
  const fn = module?.[name] as
    | ((
        ...a: Parameters<PosPrinterModule[M]>
      ) => ReturnType<PosPrinterModule[M]>)
    | undefined;
  if (typeof fn !== 'function') {
    return Promise.reject(unsupported()) as ReturnType<PosPrinterModule[M]>;
  }
  try {
    return fn.apply(module, args);
  } catch (error) {
    return Promise.reject(error) as ReturnType<PosPrinterModule[M]>;
  }
}

export const PosPrinter: PosPrinterModule = {
  getSavedOrigin: () => call('getSavedOrigin'),
  saveOrigin: origin => call('saveOrigin', origin),
  clearOrigin: () => call('clearOrigin'),
  newToken: () => call('newToken'),
  appInfo: () => call('appInfo'),
  getStatus: () => call('getStatus'),
  listPrinters: scan => call('listPrinters', scan),
  selectPrinter: id => call('selectPrinter', id),
  selectTcp: (host, port) => call('selectTcp', host, port),
  reconnect: () => call('reconnect'),
  forget: () => call('forget'),
  print: base64 => call('print', base64),
  refreshStatus: () => call('refreshStatus'),
  enableBluetooth: () => call('enableBluetooth'),
  setHostActive: (active, label) => call('setHostActive', active, label),
  moveTaskToBack: () => call('moveTaskToBack'),
  attachWebView: (tag, script, origin) =>
    call('attachWebView', tag, script, origin),
  deliverScript: script => call('deliverScript', script),
};

// Asks Android for the permission, then has the module re-read its status.
async function requestAndRefresh(kind: NativePermissionKind): Promise<boolean> {
  const granted = await requestPermission(kind);
  try {
    await PosPrinter.refreshStatus();
  } catch {
    // status events reach the page natively; a failed refresh is not fatal
  }
  return granted;
}

export const nativePort: NativePort = {
  appInfo: () => PosPrinter.appInfo(),
  getStatus: () => PosPrinter.getStatus(),
  listPrinters: scan => PosPrinter.listPrinters(scan),
  selectPrinter: id => PosPrinter.selectPrinter(id),
  selectTcp: (host, port) => PosPrinter.selectTcp(host, port),
  reconnect: () => PosPrinter.reconnect(),
  forget: () => PosPrinter.forget(),
  print: base64 => PosPrinter.print(base64),
  requestPermission: requestAndRefresh,
  enableBluetooth: () => PosPrinter.enableBluetooth(),
  setHostActive: (active, label) => PosPrinter.setHostActive(active, label),
};
