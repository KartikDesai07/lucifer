// Which nav row to scroll into view (U0 Task 2, fix round 1). The current page's row when it is rendered: a flat row,
// a sub-row in the wide form, the Settings hub. In the 76px rail a sub-page's row is not rendered (its sub-rows are
// display:none and the flyout is closed), so the lit group row (data-active) is the one to bring into view. Pure over
// a tiny DOM shape, so the rule is unit-tested (lib/nav-shell.test.ts).

interface Rendered {
  getClientRects(): { length: number };
}

export function litNavRow<T extends Rendered>(nav: { querySelectorAll(selector: string): ArrayLike<T> }): T | undefined {
  const firstShown = (selector: string): T | undefined =>
    Array.from(nav.querySelectorAll(selector)).find((el) => el.getClientRects().length > 0);
  return firstShown('[aria-current="page"]') ?? firstShown('[data-active="true"]');
}
