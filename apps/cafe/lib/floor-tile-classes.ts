// The Floor's area sections and tiles: their class strings (U3 Task 3, 2026-10-28), the owner's HTML Floor screen
// (docs/superpowers/specs/2026-10-28-floor-html-values.md values 3.1-3.2 sections, 4.1-4.5 tiles; design 6.4 / 6.5 in
// docs/superpowers/specs/2026-10-28-floor-match-html-design.md). Split from lib/floor-layout.ts by ruling F1 (each file
// within 300 lines), in its style: every class name is written out here, so Tailwind's source scanner sees each one, and
// the pins (lib/floor-view.test.ts) read the SAME constants the tile and the sections render. The per-state colours are
// lib/floor-view.ts's FLOOR_TILE_TONES; the grid is lib/floor-tiles.ts's FLOOR_GRID_CLASS. U3 Task 4 adds the tile's
// wrapper and motion, its right slot and the ⋯ trigger (design 6.5; values 4.1, 6.1-6.3, 7).

// ── The area sections (values 3.1-3.2, design 6.4) ──────────────────────────────────────────────────────────────────

/** A section (values 3.1): its head over its grid, 10px apart; no divider (the body's 16px gap parts the sections). */
export const FLOOR_SECTION_CLASS = "flex flex-col gap-2.5";
/** The head (values 3.1): the name and the count on one baseline, 8px apart, on one line. */
export const FLOOR_SECTION_HEAD_CLASS = "flex items-baseline gap-2";
/** The area's name (values 3.1): 15px 600 in --text; a long name truncates, its full name in `title` (today's). */
export const FLOOR_SECTION_NAME_CLASS = "min-w-0 truncate text-[15px] font-semibold";
/** The HTML's count of the tiles shown (values 3.1): 12px --text-2; it keeps its width beside a long name. */
export const FLOOR_SECTION_COUNT_CLASS = "flex-none text-[12px] text-muted-foreground";
/** The permanent list that holds the sections (VC-3, rulings F33 / F35; components/tables/FloorAreaSections.tsx says
 *  why): the body's own column (lib/floor-layout.ts FLOOR_BODY_CLASS, pinned equal), so the sections stay 16px apart. */
export const FLOOR_SECTIONS_CLASS = "flex flex-col gap-4";
/** Each section's permanent inner column around its head and grid (VC-3): the section's own column (FLOOR_SECTION_CLASS,
 *  pinned equal), so the head and the grid stay 10px apart. */
export const FLOOR_SECTION_INNER_CLASS = "flex flex-col gap-2.5";

// ── The tile (values 4.1, 4.4; design 6.5, owner Q2) ────────────────────────────────────────────────────────────────

/** The Floor's keyboard focus ring, written once (final review M2): today's 2px accent ring, 1px out (design 6.5: the
 *  HTML draws none, values 12 #9). The tile wears it, and so do the empty states' two buttons (lib/floor-layout.ts). */
export const FLOOR_FOCUS_RING_CLASS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";

/**
 * The tile's surface (values 4.1): a column, its top row and bottom block pushed apart (8px at least), a 1.5px border
 * (Chrome draws 1px, values 0.5), radius 14, padding 12, 112px tall (100 on the phone; content never grows it), the
 * HTML's --text and normal line-height. It fills its grid cell (h-full), so a tile that grows grows its whole row as the
 * HTML's (values 4.7). The Floor's focus ring.
 */
export const FLOOR_TILE_CLASS = `flex h-full min-h-[112px] w-full flex-col justify-between gap-2 rounded-[14px] border-[1.5px] p-3 text-left leading-[normal] text-foreground max-tab:min-h-[100px] ${FLOOR_FOCUS_RING_CLASS}`;
/** The top row (values 4.1): the name left, the seats right, top-aligned, with the HTML's no gap (ruling F9: "T-16" and
 *  "6 seats" fit the 88px phone row). The name comes first (the owner's Q6, design 6.5), CSS only: the row wraps, its
 *  lines packed at the top, and shows one 26px line (the name box's height at the HTML's normal line-height, measured at
 *  every width) with the rest clipped, so seats that do not fit beside the name drop to the hidden second line and that
 *  tile shows the name whole. Its height is fixed, so the row never grows. The seats stay in the markup (the tile's
 *  aria-label carries them; a div surface reads them). Clip, not hidden (final re-review N1): a hidden box can still be
 *  scrolled by a script, a text link or a screen reader's reveal, which would slide the name up and the seats in. The
 *  HTML's width:100% (VC-1): WebView 109's UA sheet gives a <button> align-items:flex-start, which shrank this row (and
 *  the bottom block) to its content on a button tile (Seat now, Free table); full width, it spans the tile everywhere. */
export const FLOOR_TILE_TOP_CLASS = "flex h-[26px] w-full flex-wrap content-start items-start justify-between overflow-clip";
/** The table's full name (design 6.5: `tableNo`, not the HTML's "T{n}"): 20px 600 -0.01em; never wider than the row, so
 *  only a name wider than the whole row truncates (the owner's Q6; Review Focus 3). At least the row's 26px (final
 *  re-review N2), so a shorter fallback face during the font swap still starts the hidden seats below the clip. */
export const FLOOR_TILE_NAME_CLASS = "min-h-[26px] min-w-0 max-w-full truncate text-[20px] font-semibold tracking-[-0.01em]";
/** "{n} seats" (values 4.1): 12px --text-2; never shrinks or wraps (values 12 #21 not copied): when the name and the
 *  seats do not both fit, the seats give way (the owner's Q6, the top row's clip). */
export const FLOOR_TILE_SEATS_CLASS = "flex-none whitespace-nowrap text-[12px] text-muted-foreground";
/** The bottom block (values 4.1): the status line over the detail line, 2px apart, the HTML's width:100% (VC-1, as the
 *  top row: so the detail line cuts at the tile's edge on WebView 109's button tiles too). */
export const FLOOR_TILE_BOTTOM_CLASS = "flex w-full flex-col gap-0.5";
/** The status line (values 4.1): the 7px dot, 6px, the word; 12.5px 500 in the state's ink (the tone's label class). */
export const FLOOR_TILE_STATUS_CLASS = "flex items-center gap-1.5 text-[12.5px] font-medium";
/** The status word: never wraps and is never cut (P13's meaning; the tile's text signal). */
export const FLOOR_TILE_WORD_CLASS = "whitespace-nowrap";
/** The status dot (values 4.1): 7px, the HTML's 50% radius exactly (as the pills' dot), in the state's colour (the
 *  tone's dot class). */
export const FLOOR_TILE_DOT_CLASS = "size-[7px] flex-none rounded-[50%]";
/** The detail line (values 4.1): 12.5px --text-2, one line, an ellipsis when it does not fit. */
export const FLOOR_TILE_DETAIL_CLASS = "truncate text-[12.5px] text-muted-foreground";
/** The table charge line (the owner's Q7, design 6.5 K5): the detail line laid out as a row of its label and its amount,
 *  so the label alone gives way ("Rooftop se… ₹50"); its box, font and colour stay the detail line's. */
export const FLOOR_DETAIL_CHARGE_CLASS = "flex";
/** The charge's label: shrinks below its words and cuts with the ellipsis, first and alone. */
export const FLOOR_CHARGE_LABEL_CLASS = "min-w-0 truncate";
/** The charge's amount: never shrinks, so it always shows whole; the one space before it is its own first character
 *  (kept, where a flex item's leading space would be dropped), so the line reads "{label} ₹x" as before. */
export const FLOOR_CHARGE_AMOUNT_CLASS = "flex-none whitespace-pre";
/** The detail's long word, from 720px ("Tap to seat guests"; a stay's "1h 12m"). */
export const FLOOR_DETAIL_WIDE_CLASS = "max-tab:hidden";
/** The detail's phone word, below 720px ("Tap to seat": the HTML's "Tap to seat gu…" is not copied, design 8 #1; a stay's
 *  "72m", the owner's answer 2026-10-28). */
export const FLOOR_DETAIL_PHONE_CLASS = "tab:hidden";
/** A long stay (design 6.5, ruling F3): the time on the detail line in --bad-i, 600; the clock mark is the right slot's. */
export const FLOOR_STAY_LONG_CLASS = "font-semibold text-status-bad-ink";
/** The bills still loading (K3, design 6.5): a short bar the detail line's height, so the tile keeps its rhythm. */
export const FLOOR_DETAIL_SKELETON_CLASS = "h-[17px] w-16";

// ── The wrapper and its motion (design 6.5; values 6.1-6.3, 7) ───────────────────────────────────────────────────────

/** The tile's grid item: it holds the surface and its ⋯ sibling, so the rise and the lift move both (design 6.5); the
 *  tile's 14px radius, so the lift's shadow follows its corners. */
export const FLOOR_TILE_WRAP_CLASS = "relative rounded-[14px]";
/** The HTML's rise (values 7: opacity 0 → 1, 12px up, .5s cubic-bezier(.2,.8,.2,1) both), the grid's first paint's
 *  cascade only: its delay inline, its tileDelay step (ruling P52) on the page's cascade clock (ruling F15, components/
 *  tables/FloorTile.tsx); none with reduced motion (values 12 #23 not copied). */
export const FLOOR_TILE_RISE_CLASS = "motion-safe:animate-html-rise-floor";
/** The rise's length in seconds, the token's (app/globals.css --animate-html-rise-floor, pinned equal): a tile mounted
 *  this long past its own start would rise no more, so it appears at once (ruling F15). */
export const FLOOR_TILE_RISE_SECONDS = 0.5;
/** The HTML's hover lift (values 6.1: 3px up, 0 12px 28px rgba(0,0,0,.1); its transition, values 0.5: the move .3s on
 *  cubic-bezier(.2,.8,.2,1), the shadow .3s ease) where a pointer can hover, on a tile a tap acts on. Tailwind's lift is
 *  the translate property, so it composes with the rise's held transform (the HTML needs !important for that). While the
 *  surface is pressed the lift gives way (values 6.2: the press replaces the hover's translate; its shadow stays). With
 *  reduced motion it moves without the glide (values 7: the HTML's every transition 0.01ms; U1's ProductCard's way). */
export const FLOOR_TILE_LIFT_CLASS =
  "transition-[translate,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1),ease] motion-reduce:transition-none hover:-translate-y-[3px] hover:[box-shadow:0_12px_28px_rgba(0,0,0,0.1)] has-[[data-ui=floor-tile]:active]:translate-y-0";
/** A tap target's surface (values 4.1, 6.2): the HTML's hand cursor and its press, scale(.98) on the tile's .3s curve;
 *  no glide with reduced motion (values 7). */
export const FLOOR_TILE_PRESS_CLASS =
  "cursor-pointer transition-[scale] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none active:scale-[.98]";

// ── The right slot (design 6.5) ──────────────────────────────────────────────────────────────────────────────────────

/** The status line's room for the slot (the 16px glyph and 6px), so "Reserved" + ⋯ fit the 88px phone line; positioned,
 *  so the surface's own slot sits at its right end. */
export const FLOOR_STATUS_ROOM_CLASS = "relative pr-[22px]";
/** The same room from 720px only, for a slot that shows only there (a long stay's clock on a money line). */
export const FLOOR_STATUS_ROOM_WIDE_CLASS = "relative tab:pr-[22px]";
/** The surface's slot (a busy tile's spinner, a long stay's clock): at the status line's right end, its glyph centred on
 *  the line and its right edge on the tile's inner edge, the ⋯ glyph's place. */
export const FLOOR_TILE_SLOT_CLASS = "absolute inset-y-0 right-0 flex items-center";
/** The long-stay mark (design 6.5): a 14px clock in --bad-i. */
export const FLOOR_LONG_STAY_CLOCK_CLASS = "size-3.5 text-status-bad-ink";
/** A busy tile's spinner (today's), 14px. */
export const FLOOR_TILE_SPINNER_CLASS = "size-3.5 animate-spin";
/**
 * The ⋯ trigger, a sibling after the surface (design 6.5; the 44px rule, ruling R1): at the tile's right edge, its foot
 * 30px above the tile's (the detail line's top on 112 and 100px tiles, so it never covers the detail), 44 × 44 (any
 * pointer that is not fine, a (pointer: none) device too), 32 × 32 with a fine pointer; the glyph at its bottom-right,
 * 13px in (the 1px border + 12px padding) and 2.5px up, so its centre sits on the status line's centre. Today's ghost
 * look in tokens: --text-2, --text on hover, the accent ring. Busy (disabled): no target, a press goes to the busy
 * surface below (today's kit button), and the surface's 70% dim, so the spinner reads the same with or without the ⋯
 * (ruling F16).
 */
export const FLOOR_TILE_TRIGGER_CLASS =
  "absolute bottom-[30px] right-0 flex cursor-pointer items-end justify-end rounded-[8px] pb-[2.5px] pr-[13px] text-muted-foreground size-11 pointer-fine:size-8 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-70";
/** The ⋯ glyph (lucide Ellipsis), 16px. */
export const FLOOR_TILE_GLYPH_CLASS = "size-4";
/** The trigger's spinner while busy: 14px, 1px up, so its centre is the glyph's (on the status line's centre). */
export const FLOOR_TILE_TRIGGER_SPINNER_CLASS = "mb-px size-3.5 animate-spin";
