"use client";

import { useEffect } from "react";
import { nativeClient, NATIVE_READY_EVENT } from "@/lib/printer/native-bridge";

// The web app stays mounted during native transitions. Signal hydration plus
// paint instead of letting the shell expose an unfinished first frame.
export function NativeAppExperience() {
  useEffect(() => {
    let frame = 0;
    let disposed = false;
    const prepare = () => {
      if (!nativeClient() || disposed) return;
      document.documentElement.dataset.posNative = "true";
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          if (disposed) return;
          const host = window as unknown as { ReactNativeWebView?: { postMessage(message: string): void } };
          host.ReactNativeWebView?.postMessage(JSON.stringify({ type: "pos.shell.ready", origin: location.origin }));
        });
      });
    };
    prepare();
    window.addEventListener(NATIVE_READY_EVENT, prepare);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener(NATIVE_READY_EVENT, prepare);
      delete document.documentElement.dataset.posNative;
    };
  }, []);
  return null;
}
