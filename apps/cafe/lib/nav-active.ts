// Which sidebar row is "you are here". Pure, so the rule is unit-tested
// (lib/nav-active.test.ts) rather than read off a component.

/** Whether the nav row for `url` is the current page. The root row lights
 *  only on "/" itself; any other row also lights on its own sub-pages
 *  ("/orders/123" under "/orders") — never on a sibling that merely shares a
 *  prefix ("/orders-archive" is not under "/orders"). */
export function isActivePath(pathname: string, url: string): boolean {
  if (url === "/") return pathname === "/";
  return pathname === url || pathname.startsWith(`${url}/`);
}
