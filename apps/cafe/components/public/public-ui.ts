// CB-6C — the diner surface's shared visual vocabulary: ONE place for the
// class strings every /m tab composes its cards, chips, heroes and rows from,
// so Home/Menu/Orders/Rewards/Account read as one product rather than five
// hand-styled screens. Zero React here (class strings only), same discipline
// as public-shell-layout.ts.
//
// Colour utilities are restricted to the tokens appearanceCssVars emits
// (pinned by lib/appearance-paths-2.test.ts's A5 walk): primary, accent,
// muted, card, secondary, destructive and their foregrounds. Opacity
// modifiers (`bg-primary/10`) are fine — they resolve through the same
// custom property, so every preset the owner can pick stays on-brand in
// both colour schemes. The accent fill is deliberately absent: a strong fill
// that must always pair with text-accent-foreground (its own pin).
//
// Tailwind's JIT scans source text for whole literals — every string below
// MUST stay a hand-written literal, never built from a template.

// A content card: the default surface for anything that is not the hero.
export const PUB_CARD_CLASS = "rounded-2xl border bg-card text-card-foreground shadow-sm";
export const PUB_CARD_PAD_CLASS = "p-4";

// Section titles inside a tab ("Popular here", "Your stamp card").
export const PUB_SECTION_TITLE_CLASS = "font-pub-display text-base font-semibold leading-tight";

// Small uppercase label above a group (date groups, "Your note").
export const PUB_EYEBROW_CLASS = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

// The brand hero block (Home hero, the Rewards stamp card): the cafe's own
// primary colour as a full surface, text in the matching foreground.
export const PUB_HERO_CLASS = "relative overflow-hidden rounded-2xl bg-primary text-primary-foreground";
// Decorative translucent circles laid over the hero so a photo-less cafe
// still gets depth (position/size come from the caller's own literal).
export const PUB_HERO_ORNAMENT_CLASS = "pointer-events-none absolute rounded-full bg-primary-foreground/10";

// A soft brand tint for pills, avatars and highlighted rows.
export const PUB_TINT_CLASS = "bg-primary/10 text-primary";

// A status/label chip — pair with a colour class from PublicStatusChip or
// PUB_TINT_CLASS; the chip itself carries an icon + a WORD, never colour alone.
export const PUB_CHIP_CLASS = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium";

// The visible "yes, that registered" press feedback for tappable cards —
// compositor-only (scale), gated on a coarse pointer like the rest of /m.
export const PUB_PRESS_CLASS = "touch-manipulation select-none transition-transform pointer-coarse:active:scale-[0.98]";

// A horizontal, snap-scrolling row of cards (banners, popular items, offers).
export const PUB_HSCROLL_CLASS = "flex gap-3 overflow-x-auto pb-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

// A full-width tappable row (list rows, "Your orders" shortcut) — floored at
// the 44px touch target like every other control on this surface.
export const PUB_ROW_BUTTON_CLASS = "flex min-h-11 w-full items-center gap-3 text-left";

// A button that sits ON the hero: inverted so it stays readable on the brand
// colour whatever preset the owner picked.
export const PUB_INVERTED_BUTTON_CLASS = "bg-primary-foreground text-primary hover:bg-primary-foreground/90";

// CB-6D-A — the premium Home redesign's own vocabulary (Starbucks-style: calm,
// lots of whitespace, the stamp card as the hero). Kept alongside the CB-6C
// set above rather than replacing it — Orders/Rewards/Account/Menu still draw
// on PUB_CARD_CLASS etc; only Home's own sections use these.

// Home's outer stack: more air between sections than the other tabs' default.
export const PUB_HOME_STACK_CLASS = "space-y-6 px-pub-pad pt-pub-pad pb-2";

// The diner's name / cafe name heading in the hero — one display-font size
// used nowhere else on Home, so the stamp card number stays the visual anchor.
export const PUB_DISPLAY_TITLE_CLASS = "font-pub-display text-3xl font-semibold leading-tight tracking-tight";

// A section heading ("Daily offers", "Popular here") — smaller than the hero
// title so the hierarchy reads hero > stamp card > section.
export const PUB_SECTION_HEADING_CLASS = "font-pub-display text-xl font-semibold leading-tight";

// The stamp-card hero surface: rounded-3xl (softer than the other cards'
// rounded-2xl) so it reads as the one "big" element on the page.
export const PUB_HERO_LG_CLASS = "relative overflow-hidden rounded-3xl bg-primary text-primary-foreground";

// A quiet tonal surface for everything that is not the stamp card hero (the
// live order card, announcement banners, "order again") — same radius as the
// hero so the page reads as one family of surfaces.
export const PUB_TONAL_CARD_CLASS = "rounded-3xl bg-muted text-foreground";

// A text-style link control ("See menu →") — padded out to the 44px floor
// like every other control on this surface even though the visible text stays small.
export const PUB_TEXT_LINK_CLASS = "inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary";

// CB-6D-B - the Orders/Rewards rebuild shares Home's vocabulary and adds the
// two literals both tabs need and Home never did.

// The tab's own title ("Your orders", "Rewards") - one step under Home's
// 3xl display name, so the diner's name stays the biggest word on /m.
export const PUB_SCREEN_TITLE_CLASS = "font-pub-display text-2xl font-semibold leading-tight tracking-tight";

// The ONE primary action per screen (Track this order / Order this again /
// Browse the menu / Sign in): a full-width pill on the 44px floor. Compose
// with Button via cn(PUB_PILL_BUTTON_CLASS, PUBLIC_TOUCH_TARGET_CLASS).
export const PUB_PILL_BUTTON_CLASS = "h-11 w-full rounded-full";
