import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import { isSafeHttpsLink } from "@pos/shared/print-qr";
import { inr } from "@/lib/utils";
import { fmtTime } from "@/components/print/slip/slip-format";
import {
  ITEM_GAP,
  PICTURE_ONLY,
  TEXT_SUB_LINE_INDENT,
  keptTextRow,
  splitRow,
  textRow,
  type KotTextDesign,
} from "./kot-text-design";
import type { TextRow } from "./text-layout";

// Classic's kitchen ticket as text (printing Phase 4, spec 2026-10-15 §4.3): the twin of
// components/print/slip/kot-classic-blocks.tsx (and of the legacy KOTReceipt, whose Classic template is the same
// list). Each block prints the same words in the same order as there (kot-text-parity.test.ts); the sizes are that
// file's em classes: 1.29em lines double height, the ticket number (1.6em) double size, the rest normal.

const MOVED_TITLE = "*** TABLE MOVED ***";
const MOVED_SUBTITLE = "FOOD ALREADY ORDERED — DO NOT MAKE AGAIN";
const VOID_TITLE = "*** VOID ***";
const VOID_SUBTITLE = "CANCELLED ITEMS — DO NOT MAKE";
const KOT_TITLE = "KITCHEN ORDER";

/** Classic's meta wrapper (slip-groups.ts kotMeta: "space-y-0.5 text-[0.93em]"). */
const META_RATIO = 0.93;

export const KOT_TEXT_CLASSIC: KotTextDesign = {
  groupRatio: { orderId: META_RATIO, table: META_RATIO, time: META_RATIO, staff: META_RATIO, voidReason: META_RATIO },
  rows: {
    logo: (_block, { logoUrl }) => (logoUrl ? PICTURE_ONLY : []),
    name: (_block, { restaurantName }) => (restaurantName ? [textRow(restaurantName, 1.29, true, "center")] : []),
    title: (_block, { isMoved, isVoid }) => {
      if (isMoved) return [textRow(MOVED_TITLE, 1.29, true, "center"), textRow(MOVED_SUBTITLE, 0.93, true, "center")];
      if (isVoid) return [textRow(VOID_TITLE, 1.29, true, "center"), textRow(VOID_SUBTITLE, 0.93, true, "center")];
      return [textRow(KOT_TITLE, 1.29, true, "center")];
    },
    kotNo: (_block, { isMoved, roundNumber }) => (!isMoved && roundNumber !== undefined ? [textRow(`#${roundNumber}`, 1.6, true, "center")] : []),
    roundLabel: (_block, { roundLabel }) => (roundLabel ? [textRow(roundLabel, 0.93, true, "center")] : []),
    divider: (block) => [{ kind: "rule", rule: block.options?.style ?? "dashed" }],
    orderId: (_block, { order }) => [splitRow("Order", order.orderId)],
    table: (_block, { order, movedFrom }) => [
      splitRow("Table", movedFrom ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}` : order.tableNo ?? "Walk-In"),
    ],
    time: (_block, { order, movedMeta, voidMeta }) => [splitRow("Time", fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt))],
    staff: (_block, { order, movedMeta, voidMeta }) => [splitRow("Staff", movedMeta?.by ?? voidMeta?.by ?? order.receiver)],
    voidReason: (_block, { isVoid, reason }) => (isVoid && reason ? [textRow(`Reason: ${reason}`, 1, true, "left")] : []),
    items: (block, { isMoved, items }) => {
      if (isMoved) return [];
      return items.flatMap((item, i): TextRow[] => [
        ...(i > 0 ? [ITEM_GAP] : []),
        {
          kind: "item",
          name: `${item.qty} × ${orderItemLabel(item)}`,
          amount: block.options.prices ? inr(item.price * item.qty) : "",
          style: { align: "left", bold: true, ratio: 1 },
          hang: 0,
        },
        ...orderItemModifierLines(item).map((line) => textRow(line, 0.86, false, "left", { indent: TEXT_SUB_LINE_INDENT })),
        ...(item.instructions ? [textRow(`▸ ${item.instructions}`, 0.86, true, "left", { indent: TEXT_SUB_LINE_INDENT })] : []),
      ]);
    },
    notes: (_block, { order }) => (order.notes ? [{ kind: "rule", rule: "dashed" }, textRow(`Note: ${order.notes}`, 0.86, true, "left")] : []),
    itemCount: (_block, { isMoved, isVoid, items }) =>
      isMoved ? [] : [textRow(`${items.reduce((n, it) => n + it.qty, 0)} item(s)${isVoid ? " VOIDED" : ""}`, 0.86, false, "center")],
    roundTotal: (_block, { isMoved, showsPrices, roundTotal }) =>
      !isMoved && showsPrices ? [textRow(`Round total: ${inr(roundTotal)}`, 0.86, true, "center")] : [],
    station: (_block, { stationLine }) => (stationLine ? [textRow(stationLine, 1.29, true, "center")] : []),
    token: (_block, { order }) => (order.tokenNumber !== undefined ? [textRow(`TOKEN ${order.tokenNumber}`, 1.29, true, "center")] : []),
    // A link the picture would draw as a QR code has no text form; one it would not draw prints nothing either way.
    qr: (block) => (isSafeHttpsLink(block.options.url.trim()) ? PICTURE_ONLY : []),
    customText: (block) => {
      const text = block.options.text.trim();
      return text === "" ? [] : [keptTextRow(text, 0.86, false, "center")];
    },
  },
};
