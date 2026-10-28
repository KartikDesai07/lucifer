// The Floor's area sections and tiles: their class strings (U3 Task 3, 2026-10-28), the owner's HTML Floor screen
// (docs/superpowers/specs/2026-10-28-floor-html-values.md values 3.1-3.2 sections, 4.1-4.5 tiles; design 6.4 / 6.5 in
// docs/superpowers/specs/2026-10-28-floor-match-html-design.md). Split from lib/floor-layout.ts by ruling F1 (each file
// within 300 lines), in its style: every class name is written out here, so Tailwind's source scanner sees each one, and
// the pins (lib/floor-view.test.ts) read the SAME constants the tile and the sections render. The per-state colours are
// lib/floor-view.ts's FLOOR_TILE_TONES; the grid is lib/floor-tiles.ts's FLOOR_GRID_CLASS. U3 Task 4 adds the tile's
// right slot and the ⋯ trigger here.

// ── The area sections (values 3.1-3.2, design 6.4) ──────────────────────────────────────────────────────────────────

/** A section (values 3.1): its head over its grid, 10px apart; no divider (the body's 16px gap parts the sections). */
export const FLOOR_SECTION_CLASS = "flex flex-col gap-2.5";
/** The head (values 3.1): the name and the count on one baseline, 8px apart, on one line. */
export const FLOOR_SECTION_HEAD_CLASS = "flex items-baseline gap-2";
/** The area's name (values 3.1): 15px 600 in --text; a long name truncates, its full name in `title` (today's). */
export const FLOOR_SECTION_NAME_CLASS = "min-w-0 truncate text-[15px] font-semibold";
/** The HTML's count of the tiles shown (values 3.1): 12px --text-2; it keeps its width beside a long name. */
export const FLOOR_SECTION_COUNT_CLASS = "flex-none text-[12px] text-muted-foreground";

// ── The tile (values 4.1, 4.4; design 6.5, owner Q2) ────────────────────────────────────────────────────────────────

/**
 * The tile's surface (values 4.1): a column, its top row and bottom block pushed apart (8px at least), a 1.5px border
 * (Chrome draws 1px, values 0.5), radius 14, padding 12, 112px tall (100 on the phone; content never grows it), the
 * HTML's --text and normal line-height. It fills its grid cell (h-full), so a tile that grows grows its whole row as the
 * HTML's (values 4.7). Today's 2px focus ring, on the primary token (Task 4 owns the focus look).
 */
export const FLOOR_TILE_CLASS =
  "flex h-full min-h-[112px] w-full flex-col justify-between gap-2 rounded-[14px] border-[1.5px] p-3 text-left leading-[normal] text-foreground max-tab:min-h-[100px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1";
/** The top row (values 4.1): the name left, the seats right, top-aligned, with the HTML's no gap (ruling F9: "T-16" and
 *  "6 seats" fit the 88px phone row); a name that does truncate meets the seats, the HTML's own geometry (values 4.7). */
export const FLOOR_TILE_TOP_CLASS = "flex items-start justify-between";
/** The table's full name (design 6.5: `tableNo`, not the HTML's "T{n}"): 20px 600 -0.01em; truncates (Review Focus 3). */
export const FLOOR_TILE_NAME_CLASS = "min-w-0 truncate text-[20px] font-semibold tracking-[-0.01em]";
/** "{n} seats" (values 4.1): 12px --text-2; never shrinks or wraps (values 12 #21 not copied: the name gives way). */
export const FLOOR_TILE_SEATS_CLASS = "flex-none whitespace-nowrap text-[12px] text-muted-foreground";
/** The bottom block (values 4.1): the status line over the detail line, 2px apart. */
export const FLOOR_TILE_BOTTOM_CLASS = "flex flex-col gap-0.5";
/** The status line (values 4.1): the 7px dot, 6px, the word; 12.5px 500 in the state's ink (the tone's label class). */
export const FLOOR_TILE_STATUS_CLASS = "flex items-center gap-1.5 text-[12.5px] font-medium";
/** The status word: never wraps and is never cut (P13's meaning; the tile's text signal). */
export const FLOOR_TILE_WORD_CLASS = "whitespace-nowrap";
/** The status dot (values 4.1): 7px, the HTML's 50% radius exactly (as the pills' dot), in the state's colour (the
 *  tone's dot class). */
export const FLOOR_TILE_DOT_CLASS = "size-[7px] flex-none rounded-[50%]";
/** The detail line (values 4.1): 12.5px --text-2, one line, an ellipsis when it does not fit. */
export const FLOOR_TILE_DETAIL_CLASS = "truncate text-[12.5px] text-muted-foreground";
/** The detail's long word, from 720px ("Tap to seat guests"). */
export const FLOOR_DETAIL_WIDE_CLASS = "max-tab:hidden";
/** The detail's phone word, below 720px ("Tap to seat": the HTML's "Tap to seat gu…" is not copied, design 8 #1). */
export const FLOOR_DETAIL_PHONE_CLASS = "tab:hidden";
/** A long stay (design 6.5, ruling F3): the time on the detail line in --bad-i, 600. Task 4 adds the clock mark. */
export const FLOOR_STAY_LONG_CLASS = "font-semibold text-status-bad-ink";
/** The bills still loading (K3, design 6.5): a short bar the detail line's height, so the tile keeps its rhythm. */
export const FLOOR_DETAIL_SKELETON_CLASS = "h-[17px] w-16";
