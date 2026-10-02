import { nativeBridge } from "@/lib/printer/native-bridge";
import type { BluetoothLike, SerialLike } from "@/lib/printer/web-printer-types";

// Capability detection ONLY — the presence of an API object, never a guess from
// the browser's identity string (device-agnostic-is-the-product-bar). Every
// accessor re-reads at call time and guards a missing window/navigator, so the
// module is Node-loadable and a late-arriving API is seen on the next call.
// This file never imports the desktop-shell seam (that import is one-way, from
// print-lane.ts).

interface NavigatorWithPrinterApis {
  serial?: SerialLike;
  bluetooth?: BluetoothLike;
}

function navigatorApis(): NavigatorWithPrinterApis | null {
  return typeof navigator === "undefined" ? null : (navigator as unknown as NavigatorWithPrinterApis);
}

export function serialApi(): SerialLike | null {
  const api = navigatorApis()?.serial;
  return api && typeof api.requestPort === "function" && typeof api.getPorts === "function" ? api : null;
}

export function bluetoothApi(): BluetoothLike | null {
  const api = navigatorApis()?.bluetooth;
  return api && typeof api.requestDevice === "function" ? api : null;
}

// The POS app's WebView injects this object before the page loads, earlier than
// the PosNative bridge can arrive (an old WebView hands that one over late). Inside
// the app window.print() does nothing, so its mere presence means "no print window".
export function inAppWebView(): boolean {
  return typeof window !== "undefined" && "ReactNativeWebView" in window;
}

// Can this runtime reach a printer other than through the system print window?
export function rasterCapable(): boolean {
  return serialApi() !== null || bluetoothApi() !== null || nativeBridge() !== null || inAppWebView();
}

// Holds a Web Lock for this page's whole life (a callback promise that never
// settles is the documented infinite hold — the same idiom as
// hooks/use-print-host-lock.ts). The first page to ask is the owner; later ones
// hear `onElsewhere` at once, then queue and become owner the moment the holder
// closes or crashes. No Web Locks (an insecure origin, an old engine) means
// owner by default.
export function acquireTabLock(name: string, onOwner: () => void, onElsewhere: () => void): void {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  if (!locks) {
    onOwner();
    return;
  }
  const hold = (): Promise<never> => new Promise<never>(() => undefined);
  locks
    .request(name, { ifAvailable: true }, (lock) => {
      if (lock !== null) {
        onOwner();
        return hold();
      }
      onElsewhere();
      void locks
        .request(name, () => {
          onOwner();
          return hold();
        })
        .catch(onOwner);
      return undefined;
    })
    .catch(onOwner);
}

// Subscribes to a window event; returns the remover. Safe in Node (no window).
export function onWindowEvent(name: string, listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return () => undefined;
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}
