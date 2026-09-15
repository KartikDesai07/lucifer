"use client";

import { useLayoutEffect } from "react";

import { POS_TOUCH_ATTR } from "@/lib/pos-layout";

// Publishes the touch-feel scope attribute on <html> while the staff
// dashboard is mounted — globals.css keys its CB-1d.1 touch rules on it.
// Dialogs and sheets portal to <body>, so no in-flow wrapper class can reach
// them, and the /m diner flow (which never mounts this) keeps its owner-
// accepted behavior untouched. Same publish/remove shape as RequestAlertBar's
// --pos-alert-h; a layout effect so the attribute is on before the first
// HYDRATED frame paints. A cold SSR load renders without it until hydration —
// accepted (review g14): no JS handlers exist yet, and the device-width
// viewport already removes the tap delay on Chromium.
export function TouchFeel() {
  useLayoutEffect(() => {
    document.documentElement.setAttribute(POS_TOUCH_ATTR, "");
    return () => document.documentElement.removeAttribute(POS_TOUCH_ATTR);
  }, []);
  return null;
}
