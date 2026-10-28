"use client";

import type { MouseEvent, ReactNode } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { FLOOR_POS_PATH, type FloorMenuAction, type FloorTileModel } from "@/lib/floor-tiles";
import {
  FLOOR_DETAIL_PHONE_CLASS,
  FLOOR_DETAIL_SKELETON_CLASS,
  FLOOR_DETAIL_WIDE_CLASS,
  FLOOR_STAY_LONG_CLASS,
  FLOOR_TILE_BOTTOM_CLASS,
  FLOOR_TILE_CLASS,
  FLOOR_TILE_DETAIL_CLASS,
  FLOOR_TILE_DOT_CLASS,
  FLOOR_TILE_NAME_CLASS,
  FLOOR_TILE_SEATS_CLASS,
  FLOOR_TILE_STATUS_CLASS,
  FLOOR_TILE_TOP_CLASS,
  FLOOR_TILE_WORD_CLASS,
} from "@/lib/floor-tile-classes";
import { FLOOR_TILE_TONES, floorTileView, type FloorDetail } from "@/lib/floor-view";
import { offerPosTable } from "@/lib/pos-table-handoff";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorTileMenu } from "@/components/tables/FloorTileMenu";

interface FloorTileProps {
  tile: FloorTileModel;
  /** A write (or its open-bill check) is running for THIS table only. */
  busy: boolean;
  /** The open bills failed to load and there is no older list to show. */
  tabsFailed: boolean;
  onTap: (tile: FloorTileModel) => void;
  onMenu: (tile: FloorTileModel, action: FloorMenuAction) => void;
}

// Only a surface that does something on a tap reacts to the pointer, with the HTML's hand cursor (values 4.1; a <button>
// would show the default arrow). Task 4 moves the HTML's lift to the wrapper.
const TAPPABLE_CLASS = "cursor-pointer transition-shadow hover:shadow-md active:shadow-none";

// The hand-off is offered only for a plain primary click: a middle / modifier
// click opens a plain New Order in a new tab, which must not carry the table.
function offerOnPlainClick(e: MouseEvent<HTMLAnchorElement>, tableNo: string) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  offerPosTable(tableNo, Date.now());
}

// The detail line (design 6.5): the bill and its stay (red and bold on a long stay, ruling F3), the words (the phone's
// shorter form below 720px), or a short bar while the bills load.
function TileDetail({ detail, longStay }: { detail: FloorDetail; longStay: boolean }) {
  if (detail.kind === "skeleton") return <Skeleton data-ui="floor-tile-detail" className={FLOOR_DETAIL_SKELETON_CLASS} />;
  let words: ReactNode = detail.kind === "text" ? detail.text : null;
  if (detail.kind === "money") {
    words = (
      <>
        {`${detail.amount} · `}
        <span data-ui="floor-tile-stay" className={longStay ? FLOOR_STAY_LONG_CLASS : undefined}>
          {detail.stay}
        </span>
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
// target (a link to New Order, or a button that opens a confirm), and the ⋯ menu is a sibling.
export function FloorTile({ tile, busy, tabsFailed, onTap, onMenu }: FloorTileProps) {
  const { table, primary, menu } = tile;
  const view = floorTileView(tile, tabsFailed);
  const tone = FLOOR_TILE_TONES[view.tone];
  const hasMenu = menu.length > 0;

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
        <span data-ui="floor-tile-status" className={cn(FLOOR_TILE_STATUS_CLASS, tone.label)}>
          <span data-ui="floor-tile-dot" className={cn(FLOOR_TILE_DOT_CLASS, tone.dot)} aria-hidden />
          <span data-ui="floor-tile-word" className={FLOOR_TILE_WORD_CLASS}>{view.label}</span>
          {/* Today's busy spinner, at the line's end until Task 4's right slot holds it. */}
          {busy && <Loader2 className="ml-auto h-3.5 w-3.5 flex-none animate-spin" aria-hidden />}
        </span>
        <TileDetail detail={view.detail} longStay={view.longStay} />
      </span>
    </>
  );

  // Ruling F12 part 1: a long stay is said on a div surface (K10, or any busy tile), which has no aria-label; a Link or
  // button tile says it in its aria-label (view.accessibleName), so the word renders on the div surfaces only, never twice.
  const longStayNote = view.longStay ? (
    <span data-ui="floor-tile-long-stay" className="sr-only">
      Long stay
    </span>
  ) : null;
  const className = cn(FLOOR_TILE_CLASS, tone.tile, busy && "opacity-70");
  let surface: ReactNode;
  // While this table's own write (or its open-bill check) runs, the tile is not
  // a target at all: a tap would race the write (e.g. hand a table that is
  // being reserved to New Order, which would then refuse it).
  if (busy) {
    surface = (
      <div aria-busy data-ui="floor-tile" data-tone={view.tone} className={className}>
        {content}
        {longStayNote}
      </div>
    );
  } else if (primary === "open" || primary === "new-order") {
    surface = (
      <Link
        href={FLOOR_POS_PATH}
        prefetch={false}
        onClick={(e) => offerOnPlainClick(e, table.tableNo)}
        aria-label={view.accessibleName}
        data-ui="floor-tile"
        data-tone={view.tone}
        className={cn(className, TAPPABLE_CLASS)}
      >
        {content}
      </Link>
    );
  } else if (primary === "seat-now" || primary === "free") {
    surface = (
      <button
        type="button"
        onClick={() => onTap(tile)}
        aria-label={view.accessibleName}
        data-ui="floor-tile"
        data-tone={view.tone}
        className={cn(className, TAPPABLE_CLASS)}
      >
        {content}
      </button>
    );
  } else {
    surface = (
      <div data-ui="floor-tile" data-tone={view.tone} className={className}>
        {content}
        {longStayNote}
      </div>
    );
  }

  return (
    <div className="relative">
      {surface}
      {hasMenu && (
        <FloorTileMenu tableNo={table.tableNo} actions={menu} disabled={busy} onPick={(a) => onMenu(tile, a)} />
      )}
    </div>
  );
}
