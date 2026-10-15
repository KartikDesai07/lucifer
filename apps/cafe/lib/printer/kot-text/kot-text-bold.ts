import { orderItemLabel, orderItemModifierLines } from "@pos/shared/utils";
import { isSafeHttpsLink } from "@pos/shared/print-qr";
import { inr } from "@/lib/utils";
import { fmtTime } from "@/components/print/slip/slip-format";
import {
  ITEM_GAP,
  PICTURE_ONLY,
  TEXT_SUB_LINE_INDENT,
  keptTextRow,
  textRow,
  type KotTextDesign,
} from "./kot-text-design";
import type { TextRow } from "./text-layout";

// Kitchen Bold's kitchen ticket as text (printing Phase 4, spec 2026-10-15 §4.3): the twin of
// components/print/slip/kot-bold-blocks.tsx, the same words in the same order (kot-text-parity.test.ts). Its look in
// the printer's font: the restaurant name, item names and the note upper case; VOID, TABLE MOVED and the note as
// white-on-black bands; the ticket number's box as a white-on-black "KOT 12" at double size (the box cannot float
// beside the meta lines in text: they follow under it); the table and the items large; its regular weight not bold.

const MOVED_TITLE = "*** TABLE MOVED ***";
const MOVED_SUBTITLE = "FOOD ALREADY ORDERED — DO NOT MAKE AGAIN";
const VOID_TITLE = "*** VOID ***";
const VOID_SUBTITLE = "CANCELLED ITEMS — DO NOT MAKE";
const KOT_TITLE = "KITCHEN ORDER";
const INSTRUCTION_PREFIX = "» ";
/** META_LINE_CLASS / SUB_LINE_CLASS: text-[0.9em]. */
const META_RATIO = 0.9;

export const KOT_TEXT_BOLD: KotTextDesign = {
  groupRatio: {},
  rows: {
    logo: (_block, { logoUrl }) => (logoUrl ? PICTURE_ONLY : []),
    name: (_block, { restaurantName }) => (restaurantName ? [textRow(restaurantName, 1.2, true, "center", { upper: true })] : []),
    title: (_block, { isMoved, isVoid }) => {
      const band = { invert: true };
      if (isMoved) return [textRow(MOVED_TITLE, 1.4, true, "center", band), textRow(MOVED_SUBTITLE, 0.95, true, "center", band)];
      if (isVoid) return [textRow(VOID_TITLE, 1.4, true, "center", band), textRow(VOID_SUBTITLE, 0.95, true, "center", band)];
      return [textRow(KOT_TITLE, 1.1, true, "center")];
    },
    station: (_block, { stationLine }) => (stationLine ? [textRow(stationLine, 1.4, true, "center")] : []),
    token: (_block, { order }) => (order.tokenNumber !== undefined ? [textRow(`TOKEN ${order.tokenNumber}`, 1.25, true, "left")] : []),
    kotNo: (_block, { isMoved, roundNumber }) =>
      !isMoved && roundNumber !== undefined ? [textRow(`KOT ${roundNumber}`, 2.2, true, "left", { invert: true })] : [],
    roundLabel: (_block, { roundLabel }) => (roundLabel ? [textRow(roundLabel, 1, true, "left")] : []),
    orderId: (_block, { order }) => [textRow(`Order ${order.orderId}`, META_RATIO, false, "left")],
    table: (_block, { order, movedFrom }) => [
      textRow(`Table ${movedFrom ? `${movedFrom} → ${order.tableNo ?? "Walk-In"}` : (order.tableNo ?? "Walk-In")}`, 1.7, true, "left"),
    ],
    time: (_block, { order, movedMeta, voidMeta }) => [
      textRow(`Time ${fmtTime(movedMeta?.at ?? voidMeta?.at ?? order.createdAt)}`, META_RATIO, false, "left"),
    ],
    staff: (_block, { order, movedMeta, voidMeta }) => [textRow(`Staff ${movedMeta?.by ?? voidMeta?.by ?? order.receiver}`, META_RATIO, false, "left")],
    voidReason: (_block, { isVoid, reason }) => (isVoid && reason ? [textRow(`Reason: ${reason}`, 1, true, "left")] : []),
    items: (block, { isMoved, items }) => {
      if (isMoved) return [];
      return items.flatMap((item, i): TextRow[] => {
        const qty = `[${item.qty}] `;
        return [
          ...(i > 0 ? [ITEM_GAP] : []),
          {
            kind: "item",
            name: `${qty}${orderItemLabel(item)}`,
            amount: block.options.prices ? inr(item.price * item.qty) : "",
            style: { align: "left", bold: true, ratio: 1.25, upper: true },
            hang: qty.length,
          },
          ...orderItemModifierLines(item).map((line) => textRow(line, META_RATIO, true, "left", { indent: TEXT_SUB_LINE_INDENT })),
          ...(item.instructions ? [textRow(`${INSTRUCTION_PREFIX}${item.instructions}`, META_RATIO, true, "left", { indent: TEXT_SUB_LINE_INDENT })] : []),
        ];
      });
    },
    notes: (_block, { order }) => (order.notes ? [textRow(`Note: ${order.notes}`, 1, true, "left", { invert: true, upper: true })] : []),
    itemCount: (_block, { isMoved, isVoid, items }) =>
      isMoved ? [] : [textRow(`${items.reduce((n, it) => n + it.qty, 0)} item(s)${isVoid ? " VOIDED" : ""}`, META_RATIO, true, "left")],
    roundTotal: (_block, { isMoved, showsPrices, roundTotal }) =>
      !isMoved && showsPrices ? [textRow(`Round total: ${inr(roundTotal)}`, META_RATIO, true, "left")] : [],
    qr: (block) => (isSafeHttpsLink(block.options.url.trim()) ? PICTURE_ONLY : []),
    divider: (block) => [{ kind: "rule", rule: block.options?.style ?? "double" }],
    customText: (block) => {
      const text = block.options.text.trim();
      return text === "" ? [] : [keptTextRow(text, 1, true, "center")];
    },
  },
};
