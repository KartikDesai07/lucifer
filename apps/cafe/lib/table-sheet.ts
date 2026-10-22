// U1 Task 11 (2026-10-22): the owner's HTML "Choose a table" sheet (values 9 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; the sheet keys in values 0.3 and
// docs/superpowers/specs/2026-10-19-u0-html-values.md 2.1; design 4 Q1 / Q4, 6.12): its words, its tile rules and its
// look, shared by the New Order table picker (components/pos/TableSelector.tsx) and the Move / Assign dialog
// (components/orders/MoveTableDialog.tsx + MoveTablePicker.tsx, also on the Orders page and the dashboard). Both draw
// their tiles with components/pos/TableSheet.tsx. Pure: no React, no fetching; client-safe.
import { tablePickAction } from "@/lib/table-pick";
import { isFreeTable } from "@/lib/table-status";
import { SHEET_CLOSE_CLASS, SHEET_FOOT_CLASS, SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, SHEET_SCRIM_BASE } from "@/lib/sheet-frame";
import { cn, inr } from "@/lib/utils";
import type { Order, Table } from "@/types";

// ── words (owner Q1: the HTML's where it has the element; ours for our features and data) ─────────────────────────

/** The HTML's title of the table picker (was "Select table"). The move dialog keeps its own titles. */
export const TABLE_SHEET_TITLE = "Choose a table";
/** Today's description, the picker's sub line. */
export const SELECTOR_DESCRIPTION =
  "Occupied and reserved tables can't take a new order — but an occupied table already holding one of today's open tabs jumps straight to that bill.";
/** Today's walk-in button: the foot of the picker (the HTML has none). */
export const WALK_IN_TABLE_LABEL = "Walk-In (no table)";

/** A tile's state: the HTML's free / has an order / reserved / current, and ours for an occupied table with no known
 *  tab (it cannot take a new order and there is nothing to open). */
export type TableTileKind = "free" | "open" | "occupied" | "reserved" | "current";

export interface LegendItem {
  kind: TableTileKind;
  label: string;
}

/** The HTML's legend (values 9.1). */
export const SELECTOR_LEGEND: readonly LegendItem[] = [
  { kind: "free", label: "Free" },
  { kind: "open", label: "Has an order · tap to open" },
  { kind: "reserved", label: "Reserved" },
];
/** The move dialog's: it cannot open another tab (it also opens on the Orders page), so its middle word says what its
 *  tiles are: an occupied table is not a place to move to. */
export const MOVE_LEGEND: readonly LegendItem[] = [
  { kind: "free", label: "Free" },
  { kind: "occupied", label: "Occupied" },
  { kind: "reserved", label: "Reserved" },
];

const KIND_LABEL: Record<Exclude<TableTileKind, "open">, string> = {
  free: "Free",
  occupied: "Occupied",
  reserved: "Reserved",
  current: "Current",
};

/** "4 seats", "1 seat" (never the HTML's plural slip). */
export function seatsText(capacity: number): string {
  return `${capacity} seat${capacity === 1 ? "" : "s"}`;
}

/** An area's count (values 9.1 `a.free`), upper-cased by its style: "6 free". */
export function freeText(free: number): string {
  return `${free} free`;
}

/** values 9.2: the free count per area = the tiles a new order (or the move) can take, not the current one. */
export function freeTileCount(kinds: readonly TableTileKind[]): number {
  return kinds.filter((k) => k === "free").length;
}

/** values 9.2: each tile rises 20 ms after the one before it in its area, capped at 0.3s (ruling P52, as the HTML's own
 *  Open orders rows: lib/pos-open-orders.ts) — the HTML's demo floor has about 12 tables, a real cafe's 40 or more, whose
 *  last tiles would otherwise wait most of a second to show. */
export function tileDelay(index: number): string {
  return `${Math.min(index * 0.02, 0.3).toFixed(2)}s`;
}

// ── the tile rules (behaviour unchanged: the rules TableSelector and MoveTablePicker ran inline) ─────────────────

export interface SelectorTile {
  kind: TableTileKind;
  label: string;
  /** Not a place for a new order, nothing to open, and not the chosen table. */
  disabled: boolean;
  /** A tap resumes this open tab; undefined = a tap selects the table. */
  resume: Order | undefined;
  /** The full table name, and the open tab's customer (today's tile showed it). */
  title: string;
}

/** The New Order picker's tile, on the shared tablePickAction: an occupied table holding one of today's open tabs
 *  resumes it ("₹x open"); an available table is selected ("Free"); an occupied table without a known tab and a
 *  reserved one cannot take a new order ("Occupied" / "Reserved", disabled); the chosen table stays tappable
 *  ("Current"). */
export function selectorTile(
  table: Table,
  { selected, tabs, canResume }: { selected: boolean; tabs: readonly Order[] | undefined; canResume: boolean },
): SelectorTile {
  const pick = tablePickAction(table, tabs);
  const tab = pick.kind === "resume" ? pick.tab : undefined;
  const resume = tab && canResume ? tab : undefined;
  const disabled = !selected && !resume && pick.kind !== "select";
  if (resume) {
    return { kind: "open", label: `${inr(resume.total)} open`, disabled, resume, title: `${table.tableNo} · ${resume.customerName}` };
  }
  const kind: TableTileKind = selected
    ? "current"
    : pick.kind === "select"
      ? "free"
      : pick.kind === "unavailable" && pick.reason === "reserved"
        ? "reserved"
        : "occupied";
  return { kind, label: KIND_LABEL[kind], disabled, resume: undefined, title: table.tableNo };
}

export interface MoveTile {
  kind: Exclude<TableTileKind, "open">;
  label: string;
  /** Only a free table that is not the tab's own can be moved to. */
  disabled: boolean;
}

/** The Move / Assign dialog's tile: the tab's own table is "Current"; a free table ("Free") is the only one it can
 *  move to; anything else is "Occupied" or "Reserved". */
export function moveTile(table: Table, currentTableNo: string | undefined): MoveTile {
  const current = table.tableNo === currentTableNo;
  const free = isFreeTable(table);
  const kind = current ? "current" : free ? "free" : table.status === "Reserved" ? "reserved" : "occupied";
  return { kind, label: KIND_LABEL[kind], disabled: current || !free };
}

// ── the look (values 9.1, 9.2; token names: --surface card, --text-2 muted-foreground, --text-3 subtle-foreground,
//    --accent primary, --accent-t accent, --accent-i accent-foreground, --ok / --info / --res status-*,
//    their -i inks status-*-ink, -t tints status-*-tint, -b borders status-*-border) ─────────────────────────────

/** The scrim (values 9.1; U0 2.1 sheetAlign / sheetPad): the shared sheet frame's (lib/sheet-frame.ts, ruling P54). The
 *  picker at the HTML's z-index 46 (over the cart and its sheet). */
export const SELECTOR_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-[46]");
/** The move dialog at 50 (ruling P26's way, as the payment sheet): it also opens from the Orders page's order sheet
 *  (z 50, earlier in the DOM), so it is above that sheet everywhere it opens. */
export const MOVE_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");
/** The panel (values 9.1, 0.3 csMaxH / sheetRadius) in the shared frame: 600px on --surface, content-sized up to the
 *  sheets' caps, a 1px --border, sheetIn .32s. */
export const TABLE_PANEL_CLASS = cn(
  SHEET_PANEL_BASE,
  SHEET_PANEL_CAP_CLASS,
  "max-w-[600px] overflow-hidden border border-border motion-safe:animate-html-sheet-in-cs",
);
/** The head (values 9.1): 16px 16px 10px, gap 10; the title 17px 600 over the sub 12.5px --text-2; the shared 32px
 *  round ✕ (values 8.1, 9.1). */
export const TABLE_HEAD_CLASS = "flex flex-none items-center gap-2.5 px-4 pt-4 pb-2.5";
export const TABLE_TITLE_CLASS = "text-[17px] font-semibold";
export const TABLE_SUB_CLASS = "text-[12.5px] text-muted-foreground";
export const TABLE_CLOSE_CLASS = SHEET_CLOSE_CLASS;
/** The legend (values 9.1): 0 16px 10px, 12px --text-2, 14px apart (wrapping); each word 6px after its 8px dot. */
export const TABLE_LEGEND_CLASS = "flex flex-none flex-wrap gap-3.5 px-4 pb-2.5 text-[12px] text-muted-foreground";
export const TABLE_LEGEND_ITEM_CLASS = "flex items-center gap-1.5";
export const TABLE_LEGEND_DOT_CLASS = "size-2 rounded-[50%]";
/** The body (values 9.1): the one scroller, 4px 16px 18px, 16px between areas. Our foot always follows it and adds the
 *  safe area itself (TABLE_FOOT_CLASS), so the body keeps the plain 18px (U1 final fix wave: no second inset gap). */
export const TABLE_BODY_CLASS =
  "flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pt-1 pb-[18px]";
/** An area (values 9.1): its head 8px over its grid; the head 12px 600 .04em upper-case --text-2, the name left and
 *  "{n} free" right; the grid auto-fills 92px-or-wider columns, 8px apart. */
export const TABLE_AREA_CLASS = "flex flex-col gap-2";
export const TABLE_AREA_HEAD_CLASS =
  "flex justify-between text-[12px] font-semibold tracking-[0.04em] uppercase text-muted-foreground";
export const TABLE_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2";
/** The tile (values 9.1): 78px, a 1.5px rule, radius 12, 9px 10px, the name row over the label row; it rises (.35s, its
 *  own delay) and lifts 2px on hover, only where a tap does something (important, as the HTML's hover rule, so it wins
 *  over the rise's fill). min-w-0: a long name truncates instead of widening its column. A disabled tile keeps its
 *  colours (they say why) with the not-allowed pointer (ruling P8's way) and takes no touch (a disabled button still
 *  matches :active in Chromium, and the touch layer would dim it). */
export const TABLE_TILE_CLASS =
  "flex h-[78px] min-w-0 cursor-pointer flex-col justify-between rounded-[12px] border-[1.5px] px-2.5 py-[9px] text-left text-foreground motion-safe:animate-html-rise-row enabled:hover:[transform:translateY(-2px)]! disabled:cursor-not-allowed pointer-coarse:disabled:pointer-events-none";
/** The name row (values 9.1): the name 17px 600 and "{n} seats" 11px --text-2 apart, on one baseline. */
export const TABLE_TILE_TOP_CLASS = "flex w-full items-baseline justify-between gap-1";
export const TABLE_TILE_NAME_CLASS = "min-w-0 truncate text-[17px] font-semibold";
export const TABLE_TILE_SEATS_CLASS = "whitespace-nowrap text-[11px] text-muted-foreground";
/** The label row (values 9.1): 11.5px 500 in the tile's ink, 5px after a 6px dot, on one line. */
export const TABLE_TILE_LABEL_CLASS = "flex items-center gap-[5px] overflow-hidden whitespace-nowrap text-[11.5px] font-medium";
export const TABLE_TILE_DOT_CLASS = "size-1.5 flex-none rounded-[50%]";

/** values 9.2's tile tones (bg + border [+ ring], dot, label); ours for an occupied table with no known tab. */
export const TABLE_TILE_TONES: Record<TableTileKind, { tile: string; dot: string; label: string }> = {
  free: { tile: "border-border bg-card", dot: "bg-status-ok", label: "text-status-ok-ink" },
  open: { tile: "border-status-info-border bg-status-info-tint", dot: "bg-status-info", label: "text-status-info-ink" },
  reserved: { tile: "border-status-reserved-border bg-status-reserved-tint", dot: "bg-status-reserved", label: "text-status-reserved-ink" },
  current: { tile: "border-primary bg-accent [box-shadow:0_0_0_3px_var(--accent)]", dot: "bg-primary", label: "text-accent-foreground" },
  occupied: { tile: "border-border bg-surface-2", dot: "bg-subtle-foreground", label: "text-subtle-foreground" },
};

/** Our foot (the HTML's sheet has none): the shared sheet foot (values 8.2), 12px 16px and 14px + the safe area over a
 *  --border-2 rule, 8px apart. */
export const TABLE_FOOT_CLASS = SHEET_FOOT_CLASS;
/** "Walk-In (no table)": 46px full width, a tile's 1.5px rule and radius 12, 14.5px 600; the current choice in the
 *  Current tile's colours, else a free tile's. */
export const WALK_IN_CLASS = "h-[46px] w-full cursor-pointer rounded-[12px] border-[1.5px] px-1.5 py-px text-[14.5px] font-semibold";
export const WALK_IN_CHOSEN_CLASS = "border-primary bg-accent text-accent-foreground";
export const WALK_IN_OTHER_CLASS = "border-border bg-card text-foreground hover:bg-hover";
/** "Remove from table" as a red link (design 6.12): 44px (our control), 13.5px 500 --bad-i. */
export const REMOVE_LINK_CLASS =
  "h-11 w-full cursor-pointer border-0 bg-transparent px-1.5 py-px text-[13.5px] font-medium text-status-bad-ink disabled:cursor-not-allowed disabled:opacity-50";
/** The HTML confirm's 46px buttons (values 12.1): radius 10, 14.5px 600, a 1px rule; --surface-3 (Cancel), --accent
 *  (the move), --bad (removing the table). */
const SHEET_BUTTON_CLASS =
  "h-[46px] w-full cursor-pointer rounded-[10px] border px-1.5 py-px text-[14.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50";
export const SECONDARY_BUTTON_CLASS = `${SHEET_BUTTON_CLASS} border-transparent bg-surface-3 text-foreground`;
export const PRIMARY_BUTTON_CLASS = `${SHEET_BUTTON_CLASS} border-primary bg-primary text-primary-foreground`;
export const DESTRUCTIVE_BUTTON_CLASS = `${SHEET_BUTTON_CLASS} border-status-bad bg-status-bad text-primary-foreground`;
/** The confirm step (design 6.12): in the body's padding, the HTML's note box (values 11.1: a 1px --border on
 *  --surface-2, radius 10, 14px, 13.5px --text-2 at 1.5) over the two buttons. */
export const MOVE_CONFIRM_CLASS = "flex flex-col gap-4 px-4 pt-1 pb-[calc(18px+env(safe-area-inset-bottom))]";
export const MOVE_NOTE_CLASS = "rounded-[10px] border border-border bg-surface-2 p-3.5 text-[13.5px] leading-[1.5] text-muted-foreground";
export const MOVE_BUTTONS_CLASS = "flex flex-col gap-2";
