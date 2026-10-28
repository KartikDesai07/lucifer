"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { Clock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { FLOOR_POS_PATH, type FloorMenuAction, type FloorPrimary, type FloorTileModel } from "@/lib/floor-tiles";
import {
  FLOOR_DETAIL_PHONE_CLASS,
  FLOOR_DETAIL_SKELETON_CLASS,
  FLOOR_DETAIL_WIDE_CLASS,
  FLOOR_LONG_STAY_CLOCK_CLASS,
  FLOOR_STATUS_ROOM_CLASS,
  FLOOR_STATUS_ROOM_WIDE_CLASS,
  FLOOR_STAY_LONG_CLASS,
  FLOOR_TILE_BOTTOM_CLASS,
  FLOOR_TILE_CLASS,
  FLOOR_TILE_DETAIL_CLASS,
  FLOOR_TILE_DOT_CLASS,
  FLOOR_TILE_LIFT_CLASS,
  FLOOR_TILE_NAME_CLASS,
  FLOOR_TILE_PRESS_CLASS,
  FLOOR_TILE_RISE_CLASS,
  FLOOR_TILE_RISE_SECONDS,
  FLOOR_TILE_SEATS_CLASS,
  FLOOR_TILE_SLOT_CLASS,
  FLOOR_TILE_SPINNER_CLASS,
  FLOOR_TILE_STATUS_CLASS,
  FLOOR_TILE_TOP_CLASS,
  FLOOR_TILE_WORD_CLASS,
  FLOOR_TILE_WRAP_CLASS,
} from "@/lib/floor-tile-classes";
import { FLOOR_TILE_TONES, floorTileView, type FloorDetail } from "@/lib/floor-view";
import { offerPosTable } from "@/lib/pos-table-handoff";
import { tileDelaySeconds } from "@/lib/table-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorTileMenu } from "@/components/tables/FloorTileMenu";

interface FloorTileProps {
  tile: FloorTileModel;
  /** A write (or its open-bill check) is running for THIS table only. */
  busy: boolean;
  /** The open bills failed to load and there is no older list to show. */
  tabsFailed: boolean;
  /** Its step in the rise's cascade (values 7): its table's place in its section (after the filters) on the first render
   *  the table appeared in (lib/floor-rise.ts, re-review M1); null past the cascade's window (no rise). */
  riseIndex: number | null;
  /** The ms since the page's cascade clock started (its first render with tiles, ruling F15), read by the render that
   *  renders this tile. */
  riseElapsedMs: number;
  onTap: (tile: FloorTileModel) => void;
  onMenu: (tile: FloorTileModel, action: FloorMenuAction) => void;
}

/** The surface's element, decided once (Task 3 re-review N1): a Link to /pos, a button that opens a confirm, or a div
 *  that is no target. The switch is exhaustive, so a new FloorPrimary must be placed here. */
type FloorSurface = "link" | "button" | "div";
function surfaceOf(busy: boolean, primary: FloorPrimary): FloorSurface {
  // While this table's own write (or its open-bill check) runs, the tile is not a target at all: a tap would race the
  // write (e.g. hand a table that is being reserved to New Order, which would then refuse it).
  if (busy) return "div";
  switch (primary) {
    case "open":
    case "new-order":
      return "link";
    case "seat-now":
    case "free":
      return "button";
    case "none":
      return "div";
  }
}

/**
 * The rise's animation-delay for a tile mounting `elapsedMs` into the page's cascade (ruling F15), or null when its rise
 * would already be over (or the page gives no index): its tileDelay step (ruling P52) less the time elapsed, counted in
 * tileDelay's 10ms steps (its two decimals). A negative delay starts the rise part-way: a tile remounted mid-cascade
 * continues rather than restarts.
 */
function riseDelayAtMount(index: number | null, elapsedMs: number): string | null {
  if (index === null) return null;
  const delayMs = Math.round(tileDelaySeconds(index) * 1000) - Math.floor(elapsedMs / 10) * 10;
  return delayMs + FLOOR_TILE_RISE_SECONDS * 1000 > 0 ? `${(delayMs / 1000).toFixed(2)}s` : null;
}

/** What the right slot holds (design 6.5): the ⋯ (a sibling, outside the surface), else inside the surface a busy tile's
 *  spinner or a long stay's clock. */
type FloorSlot = "menu" | "spinner" | "clock" | null;

// The hand-off is offered only for a plain primary click: a middle / modifier
// click opens a plain New Order in a new tab, which must not carry the table.
function offerOnPlainClick(e: MouseEvent<HTMLAnchorElement>, tableNo: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  offerPosTable(tableNo, Date.now());
}

// The detail line (design 6.5): the bill and its stay (red and bold on a long stay, ruling F3), the words (the phone's
// shorter form below 720px), or a short bar while the bills load. `readsText`: the surface is a div (busy, or display
// only) with no aria-label, so a screen reader reads this line itself.
function TileDetail({ detail, longStay, readsText }: { detail: FloorDetail; longStay: boolean; readsText: boolean }) {
  if (detail.kind === "skeleton") return <Skeleton data-ui="floor-tile-detail" className={FLOOR_DETAIL_SKELETON_CLASS} />;
  let words: ReactNode = detail.kind === "text" ? detail.text : null;
  if (detail.kind === "money") {
    // The owner's answer 2026-10-28: the stay as two spans, the K5 pair's way: its words from 720px, the phone's minutes
    // below 720px (one shows at a width); a long stay's red bold on both; the whole line still cuts with one ellipsis.
    // Re-review 2 N2: where the line is read, "72m" (said "72 metres" by some readers) is hidden from readers and an
    // sr-only copy of the words is read instead, below 720px only (the phone form's breakpoint), so nothing is read twice.
    const long = longStay ? FLOOR_STAY_LONG_CLASS : undefined;
    words = (
      <>
        {`${detail.amount} · `}
        <span data-ui="floor-tile-stay-wide" className={cn(FLOOR_DETAIL_WIDE_CLASS, long)}>{detail.stay}</span>
        <span data-ui="floor-tile-stay-phone" className={cn(FLOOR_DETAIL_PHONE_CLASS, long)} aria-hidden={readsText || undefined}>
          {detail.phoneStay}
        </span>
        {readsText && (
          <span data-ui="floor-tile-spoken-stay" className={cn("sr-only", FLOOR_DETAIL_PHONE_CLASS)}>
            {detail.stay}
          </span>
        )}
      </>
    );
  } else if (detail.phoneText) {
    words = (
      <>
        <span data-ui="floor-tile-detail-wide" className={FLOOR_DETAIL_WIDE_CLASS}>{detail.text}</span>
        <span data-ui="floor-tile-detail-phone" className={FLOOR_DETAIL_PHONE_CLASS}>{detail.phoneText}</span>
      </>
    );
  }
  return (
    <span data-ui="floor-tile-detail" className={FLOOR_TILE_DETAIL_CLASS}>
      {words}
    </span>
  );
}

// One table on the live floor, the owner's HTML tile (values 4.1, design 6.5): the full name and the seats on top; the
// state's dot and word over one detail line below; the state's tone on the surface. The whole tile is the primary tap
// target (a link to New Order, or a button that opens a confirm), and the ⋯ menu is a sibling in the right slot.
export function FloorTile({ tile, busy, tabsFailed, riseIndex, riseElapsedMs, onTap, onMenu }: FloorTileProps) {
  const { table, primary, menu } = tile;
  const view = floorTileView(tile, tabsFailed);
  const tone = FLOOR_TILE_TONES[view.tone];
  const hasMenu = menu.length > 0;
  const kind = surfaceOf(busy, primary);
  // A div surface has no aria-label (a Link or button names itself), so a screen reader reads its text.
  const readsText = kind === "div";
  // The rise is fixed when the tile mounts, against the page's cascade clock (ruling F15): a re-render during the cascade
  // (the bills arriving) never cuts it; a tile mounted while its rise would still run joins it part-way; one mounted
  // later (a tab / pill change after the cascade, a table added) appears at once, so nothing replays (design 6.5).
  const [riseDelay] = useState(() => riseDelayAtMount(riseIndex, riseElapsedMs));

  const slot: FloorSlot = hasMenu ? "menu" : busy ? "spinner" : view.longStay ? "clock" : null;
  // The clock shows from 720px, where the line has room (the phone keeps the red time: "Bill printed" + a clock does not
  // fit 88px); K10's detail has no time to turn red, so its clock shows at every width (ruling F12 part 2).
  const clockEveryWidth = view.detail.kind !== "money";
  const slotRoom = slot === null ? undefined : slot === "clock" && !clockEveryWidth ? FLOOR_STATUS_ROOM_WIDE_CLASS : FLOOR_STATUS_ROOM_CLASS;
  // Ruling F12: a div surface says "Long stay" once — the clock's own word where it shows at every width (K10), else an
  // sr-only word (a busy tile, its spinner in the slot). A Link or button says it in its aria-label (view.accessibleName).
  const saysLongStay = readsText && view.longStay;
  const clockSpeaks = saysLongStay && slot === "clock" && clockEveryWidth;
  const longStayWord = (
    <span data-ui="floor-tile-long-stay" className="sr-only">
      Long stay
    </span>
  );

  const content = (
    <>
      <span data-ui="floor-tile-top" className={FLOOR_TILE_TOP_CLASS}>
        <span data-ui="floor-tile-name" className={FLOOR_TILE_NAME_CLASS} title={table.tableNo}>
          {table.tableNo}
        </span>
        <span data-ui="floor-tile-seats" className={FLOOR_TILE_SEATS_CLASS}>
          {view.seats}
        </span>
      </span>
      <span data-ui="floor-tile-bottom" className={FLOOR_TILE_BOTTOM_CLASS}>
        <span data-ui="floor-tile-status" className={cn(FLOOR_TILE_STATUS_CLASS, tone.label, slotRoom)}>
          <span data-ui="floor-tile-dot" className={cn(FLOOR_TILE_DOT_CLASS, tone.dot)} aria-hidden />
          <span data-ui="floor-tile-word" className={FLOOR_TILE_WORD_CLASS}>{view.label}</span>
          {slot === "spinner" && (
            <span data-ui="floor-tile-slot" className={FLOOR_TILE_SLOT_CLASS}>
              <Loader2 className={FLOOR_TILE_SPINNER_CLASS} aria-hidden />
            </span>
          )}
          {slot === "clock" && (
            <span data-ui="floor-tile-clock" title="Long stay" className={cn(FLOOR_TILE_SLOT_CLASS, !clockEveryWidth && FLOOR_DETAIL_WIDE_CLASS)}>
              <Clock className={FLOOR_LONG_STAY_CLOCK_CLASS} aria-hidden />
              {clockSpeaks && longStayWord}
            </span>
          )}
        </span>
        <TileDetail detail={view.detail} longStay={view.longStay} readsText={readsText} />
      </span>
    </>
  );

  const className = cn(FLOOR_TILE_CLASS, tone.tile, busy && "opacity-70");
  let surface: ReactNode;
  switch (kind) {
    case "link":
      surface = (
        <Link
          href={FLOOR_POS_PATH}
          prefetch={false}
          onClick={(e) => offerOnPlainClick(e, table.tableNo)}
          aria-label={view.accessibleName}
          data-ui="floor-tile"
          data-tone={view.tone}
          className={cn(className, FLOOR_TILE_PRESS_CLASS)}
        >
          {content}
        </Link>
      );
      break;
    case "button":
      surface = (
        <button
          type="button"
          onClick={() => onTap(tile)}
          aria-label={view.accessibleName}
          data-ui="floor-tile"
          data-tone={view.tone}
          className={cn(className, FLOOR_TILE_PRESS_CLASS)}
        >
          {content}
        </button>
      );
      break;
    case "div":
      surface = (
        <div aria-busy={busy || undefined} data-ui="floor-tile" data-tone={view.tone} className={className}>
          {content}
          {saysLongStay && !clockSpeaks && longStayWord}
        </div>
      );
      break;
  }

  // The grid item (design 6.5): the rise (the first paint's cascade) and, on a tile a tap acts on, the hover lift move the
  // surface and its ⋯ together; the ⋯ stays a sibling after the surface, never inside it (P11).
  return (
    <div
      data-ui="floor-tile-wrap"
      className={cn(FLOOR_TILE_WRAP_CLASS, riseDelay !== null && FLOOR_TILE_RISE_CLASS, kind !== "div" && FLOOR_TILE_LIFT_CLASS)}
      style={riseDelay === null ? undefined : { animationDelay: riseDelay }}
    >
      {surface}
      {hasMenu && <FloorTileMenu tableNo={table.tableNo} actions={menu} busy={busy} onPick={(a) => onMenu(tile, a)} />}
    </div>
  );
}
