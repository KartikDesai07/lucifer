import type { CSSProperties } from "react";

// CB-4 — the ONE source of truth for how the diner surface's bottom-anchored
// layers stack. Zero React: class strings only, imported by every component
// that pins itself to the bottom of the /m viewport.
//
// WHY THIS FILE EXISTS (a real blocker caught in review, not a tidy-up):
// before CB-4 there was exactly one bottom-anchored layer — the cart bar
// (PublicFlowChrome) at `fixed bottom-0 z-40`. The 3-tab shell added a SECOND
// bar at the identical `fixed bottom-0 z-40`. Same edge, same z-index, so they
// stacked by DOM order and the tab bar covered the "View cart" button: a diner
// with items in their cart could not reach checkout at all.
//
// The stack, bottom-most first:
//   1. the TAB BAR sits flush on the viewport bottom (it is chrome, always
//      present, and it owns the safe-area gutter);
//   2. the CART BAR / status action bar float ABOVE it, offset by exactly the
//      tab bar's height;
//   3. transient notices float above those again.
// Every offset below is derived from ONE height constant, so the three can
// never drift apart the way two hand-written `bottom-0`s just did.

// The tab bar's own height: a 56px (min-h-14) thumb target plus its 1px top
// border. Tailwind's `bottom-14` is 3.5rem = 56px, which is the value every
// offset below is expressed in.
//
// TAB_BAR_HEIGHT_REM is that number, named once. TAB_BAR_HEIGHT_CLASS,
// SHELL_BOTTOM_CHROME_STYLE's `--pub-bottom-chrome`, and
// CONTENT_PAD_TABS_ONLY below MUST all state this SAME 3.5rem — they are
// independent literals (see the comment on each), so nothing at the type
// level stops them drifting apart the way the two `bottom-0` bars once did.
// The one thing enforcing the agreement is the pin in
// lib/public-shell-layout.test.ts that reads TAB_BAR_HEIGHT_REM and asserts
// each literal below matches it — treat that test as load-bearing, not
// incidental.
//
// WHY NOT BUILD THE CLASS STRINGS FROM THIS CONSTANT: Tailwind's JIT scans
// source text for literal class names at build time: `` `min-h-${x}` `` or
// `` `pb-[calc(${x}rem+...)]` `` never appear as a literal in the source, so
// Tailwind never generates the CSS for them and the class is silently inert
// at runtime. The class strings below MUST stay hand-written literals; the
// constant exists only for the test to check them against, not to build them.
export const TAB_BAR_HEIGHT_REM = 3.5;
export const TAB_BAR_HEIGHT_CLASS = "min-h-14";

// The tab bar itself. `pb-[env(safe-area-inset-bottom)]` keeps the row of
// targets clear of the iOS home indicator; the bar's BACKGROUND still paints
// into that gutter, so there is never a transparent strip under it.
export const TAB_BAR_CLASS =
  "fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]";

// HOW THE CART BAR LEARNS ABOUT THE TAB BAR — a CSS custom property, not a
// prop threaded through PublicOrderFlow.
//
// `--pub-bottom-chrome` is the height the bottom-anchored layers must clear.
// It defaults to 0px (declared on the /m theme wrapper), and the SHELL raises
// it to the tab bar's height on the subtree it wraps. So:
//   • a cafe with the diner features OFF renders with 0px — byte-identical
//     behaviour to before CB-4, with no prop and no conditional;
//   • with the shell present, every layer below lifts automatically.
// This is also why it is a variable rather than two class strings: the cart
// bar, the status action bar and the notices all resolve the SAME value, so
// they cannot drift apart.
export const BOTTOM_CHROME_VAR = "--pub-bottom-chrome";

// Set by PublicDinerShell on its wrapper. `3.5rem` = the tab bar's min-h-14
// = TAB_BAR_HEIGHT_REM above (pinned in the test — not built from the
// constant, see the WHY NOT comment above).
export const SHELL_BOTTOM_CHROME_STYLE = { [BOTTOM_CHROME_VAR]: "3.5rem" } as CSSProperties;

// Anything that used to sit at `bottom-0` and must now clear the tab bar.
// Resolves to plain `bottom: 0 + safe-area` when no shell is present.
export const ABOVE_TAB_BAR_CLASS =
  "bottom-[calc(var(--pub-bottom-chrome,0px)+env(safe-area-inset-bottom))]";

// A transient notice that must clear BOTH the tab bar and the cart bar above
// it (the cart bar's h-14 button plus its own padding = 4rem).
export const ABOVE_CART_BAR_CLASS =
  "bottom-[calc(var(--pub-bottom-chrome,0px)+4rem+env(safe-area-inset-bottom))]";

// Bottom padding the SCROLLING content needs so its last row is never hidden
// behind the fixed chrome. Applied by the shell to the whole tab area.
//   • tab bar only            → 3.5rem
//   • tab bar + the cart bar  → 3.5rem + 4.5rem (the cart bar's h-14 + padding)
// Plus the safe-area inset in both cases.
// The MENU's own bottom padding, in both mounts. Expressed through the same
// custom property as the bars themselves, so it is correct with the shell
// (adds the tab bar's height) AND without it (the property is 0px, leaving the
// original values). Two variants because the cart bar only exists when the
// cart is non-empty — the menu must not reserve 7rem of dead space otherwise.
//   • empty cart : the original 2.5rem breathing room + the chrome
//   • with cart  : the original 7rem (cart bar + room) + the chrome
export const MENU_PAD_NO_CART =
  "pb-[calc(2.5rem+var(--pub-bottom-chrome,0px)+env(safe-area-inset-bottom))]";
export const MENU_PAD_WITH_CART =
  "pb-[calc(7rem+var(--pub-bottom-chrome,0px)+env(safe-area-inset-bottom))]";

// Bottom padding the SHELL's own tabs (Orders/Rewards) need so their last row
// clears the tab bar. The Menu tab uses the two constants above instead, since
// it additionally has to clear the cart bar. `3.5rem` = TAB_BAR_HEIGHT_REM,
// same pin as SHELL_BOTTOM_CHROME_STYLE above.
export const CONTENT_PAD_TABS_ONLY = "pb-[calc(3.5rem+env(safe-area-inset-bottom))]";

// ── Touch targets ───────────────────────────────────────────────────────────
// The diner surface is used one-handed on cheap Android phones, so every
// control a diner taps is floored at 44px — the same rule (and the same 44px)
// PublicMenuItem's own CONTROL_FOOTPRINT already follows. shadcn's Button
// sizes are DESKTOP-first (`sm` = 32px, `default` = 36px), so a bare
// <Button> on this surface is under the floor and must be given a height.
//
// `touch-manipulation` removes the ~300ms double-tap-zoom delay, and the
// pointer-coarse press scale is the visible "yes, that registered"
// acknowledgement the rest of this app's touch controls give
// (POS_PRESS_FEEDBACK_CLASS in lib/pos-layout.ts).
export const PUBLIC_TOUCH_TARGET_CLASS =
  "h-11 touch-manipulation select-none pointer-coarse:active:scale-[0.97]";

// A text-style control (a link-looking button) still has to be TAPPABLE: the
// visible text stays small, but the hit box is padded out to the floor.
export const PUBLIC_TOUCH_TEXT_CLASS =
  "min-h-11 px-2 py-2 touch-manipulation select-none";
