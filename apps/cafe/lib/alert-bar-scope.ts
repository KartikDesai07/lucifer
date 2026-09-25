// CB-UI2 (owner requests 2026-09-23) — WHERE the staff alert band renders.
//
// The band is mounted once in the dashboard layout, so it sits above every
// screen. Two separate owner decisions narrowed it:
//
// 1. The PRINT-HOST block (offline/silent warnings, stale slip rows, readback
//    chips) and the routing note ("Slips print at <label>.") belong on the
//    DASHBOARD only. They wrapped to several lines on a 360px phone and ate
//    roughly half the viewport on screens that have nothing to do with
//    printing.
// 2. The band as a WHOLE is suppressed on the POS screen ("New Order"): that
//    is the one screen an operator works on with a customer waiting, and a
//    yellow strip above the terminal pushes the cart down and distracts.
//    Order requests and unprinted self-orders still reach the operator on
//    every other screen, and the Order Requests page itself is one tap away
//    in the sidebar (it carries its own count badge), so nothing is lost.

// The dashboard index route. Exact match ONLY — a prefix match on "/" would
// trivially catch every route in the app.
export const ALERT_DASHBOARD_PATH = "/";

// The POS terminal. Matched as a prefix so any nested POS route inherits it.
export const ALERT_SUPPRESSED_PATH_PREFIXES = ["/pos"] as const;

// True only on the dashboard index: gates the print-host block + routing note.
export function alertDetailForPath(pathname: string): boolean {
  return pathname === ALERT_DASHBOARD_PATH;
}

// True where the band must not render AT ALL (owner: "New Order me wo yellow
// line chahiye hi nahi"). Checked before any other visibility rule.
export function alertBarSuppressedForPath(pathname: string): boolean {
  return ALERT_SUPPRESSED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
