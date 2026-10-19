// The nav's collapse choice, remembered on this device (U0 Task 2, design 5.2: the Collapse/Expand button at 1280 px
// and up). The sidebar provider writes the choice to the sidebar cookie and mirrors it on <html> as
// data-nav-collapsed, which the `wide` CSS variant (app/globals.css) reads; this script, run by the dashboard layout
// before the first paint, sets the attribute from the cookie, so a reload never flashes the wide sidebar before the
// rail. Dependency-free on purpose: the server layout imports it (the lib/screen-lock-script.ts idiom).

export const NAV_STATE_COOKIE = "sidebar_state";
export const NAV_COLLAPSED_ATTR = "data-nav-collapsed";

export const NAV_STATE_SCRIPT =
  `try{if(/(?:^|;\\s*)${NAV_STATE_COOKIE}=false(?:;|$)/.test(document.cookie))` +
  `document.documentElement.setAttribute(${JSON.stringify(NAV_COLLAPSED_ATTR)},"")}catch(e){}`;
