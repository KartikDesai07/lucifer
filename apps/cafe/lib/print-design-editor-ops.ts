import {
  PRINT_QR_BLOCKS_MAX,
  PRINT_REPEAT_INDEX_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
  isRepeatableBlockType,
  type BlockAlign,
  type BlockSize,
  type DividerStyle,
  type PrintFontKey,
  type QrOptions,
  type RepeatableBlockType,
} from "@pos/shared/print-template";
import { isValidUpiId } from "@pos/shared/print-qr";
import type { PrintFontSize, PrintLogoSize } from "@/lib/constants";

// The Bill design editor's pure operations (print customization S4, 04-S4-plan D8). Generic over a structural
// EditableTemplate so S5 reuses them for the kitchen ticket. Every op returns a NEW template; a move, a removal or a
// target id that does not exist returns the SAME object, while a setter may return an equal copy (dirty is a deep
// compare, so that never matters). This file never imports the WRITE schema: lib/print-design-editor.ts is its only
// importer, so no receipt or POS bundle can reach the write gate through here.

export type LockReason = "always" | "gst" | "fssai" | "banner";

export interface EditableBlock {
  id: string;
  type: string;
  on: boolean;
  align?: BlockAlign;
  size?: BlockSize;
  bold?: boolean;
  options?: unknown;
}

export interface EditableTemplate {
  v: number;
  design: string;
  font: PrintFontKey;
  size: PrintFontSize;
  blocks: EditableBlock[];
}

export type AddCheck = { ok: true } | { ok: false; reason: string };

/** A per-field `null` removes that field (back to the design's own); a whole-patch `null` removes all three. */
export interface BlockStylePatch {
  align?: BlockAlign | null;
  size?: BlockSize | null;
  bold?: boolean | null;
}

function mapBlock<T extends EditableTemplate>(t: T, id: string, change: (block: EditableBlock) => EditableBlock): T {
  let hit = false;
  const blocks = t.blocks.map((block) => {
    if (block.id !== id) return block;
    hit = true;
    return change(block);
  });
  return hit ? { ...t, blocks } : t;
}

export function setBlockOn<T extends EditableTemplate>(t: T, id: string, on: boolean): T {
  return mapBlock(t, id, (block) => (block.on === on ? block : { ...block, on }));
}

export function setBlockStyle<T extends EditableTemplate>(t: T, id: string, patch: BlockStylePatch | null): T {
  return mapBlock(t, id, (block) => {
    const { align: oldAlign, size: oldSize, bold: oldBold, ...rest } = block;
    const align = patch === null || patch.align === null ? undefined : (patch.align ?? oldAlign);
    const size = patch === null || patch.size === null ? undefined : (patch.size ?? oldSize);
    const bold = patch === null || patch.bold === null ? undefined : (patch.bold ?? oldBold);
    const next: EditableBlock = { ...rest };
    if (align !== undefined) next.align = align;
    if (size !== undefined) next.size = size;
    if (bold !== undefined) next.bold = bold;
    return next;
  });
}

export function setLogoSize<T extends EditableTemplate>(t: T, id: string, logoSize: PrintLogoSize): T {
  return mapBlock(t, id, (block) => (block.type === "logo" ? { ...block, options: { logoSize } } : block));
}

/** `null` removes the options: the divider is then the design's own. */
export function setDividerStyle<T extends EditableTemplate>(t: T, id: string, style: DividerStyle | null): T {
  return mapBlock(t, id, (block) => {
    if (block.type !== "divider") return block;
    const next: EditableBlock = { ...block };
    delete next.options;
    if (style !== null) next.options = { style };
    return next;
  });
}

/** Kept exactly as typed (the save gate trims): trimming here would eat a space the person is still typing. */
export function setCustomText<T extends EditableTemplate>(t: T, id: string, text: string): T {
  return mapBlock(t, id, (block) => (block.type === "customText" ? { ...block, options: { text } } : block));
}

export function setQrOptions<T extends EditableTemplate>(t: T, id: string, options: QrOptions): T {
  return mapBlock(t, id, (block) => (block.type === "qr" ? { ...block, options } : block));
}

/**
 * The kitchen ticket's Items option: whether each dish prints its price. Only `prices` is written; the stored
 * `modifiers` / `instructions` stay exactly as they are (dish options and notes always print, owner Q-A, A8).
 */
export function setKotItemsPrices<T extends EditableTemplate>(t: T, id: string, prices: boolean): T {
  return mapBlock(t, id, (block) => {
    const { options } = block;
    if (block.type !== "items" || options === null || typeof options !== "object") return block;
    return { ...block, options: { ...options, prices } };
  });
}

export function setFont<T extends EditableTemplate>(t: T, font: PrintFontKey): T {
  return t.font === font ? t : { ...t, font };
}

export function setBaseSize<T extends EditableTemplate>(t: T, size: PrintFontSize): T {
  return t.size === size ? t : { ...t, size };
}

// ── Moving ───────────────────────────────────────────────────────────────────

// Same result as @dnd-kit/sortable's arrayMove, kept here so this module stays free of the UI library.
function arrayMoveOf<B>(items: readonly B[], from: number, to: number): B[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** One step up (-1) or down (+1) past the next row the editor shows: a hidden row is stepped over, never landed on. */
export function moveBlock<T extends EditableTemplate>(
  t: T,
  id: string,
  delta: -1 | 1,
  hidden: readonly string[],
): T {
  const from = t.blocks.findIndex((block) => block.id === id);
  if (from < 0) return t;
  let to = from + delta;
  while (to >= 0 && to < t.blocks.length && hidden.includes(t.blocks[to].type)) to += delta;
  if (to < 0 || to >= t.blocks.length) return t;
  return { ...t, blocks: arrayMoveOf(t.blocks, from, to) };
}

/** A drag: the active row takes the over row's place (what arrayMove does). */
export function moveBlockTo<T extends EditableTemplate>(t: T, activeId: string, overId: string): T {
  const from = t.blocks.findIndex((block) => block.id === activeId);
  const to = t.blocks.findIndex((block) => block.id === overId);
  if (from < 0 || to < 0 || from === to) return t;
  return { ...t, blocks: arrayMoveOf(t.blocks, from, to) };
}

// ── Adding and removing (repeatable lines only) ──────────────────────────────

export function addCheck<T extends EditableTemplate>(t: T, type: RepeatableBlockType): AddCheck {
  if (t.blocks.length >= PRINT_TEMPLATE_BLOCKS_MAX) {
    return { ok: false, reason: `This design can hold up to ${PRINT_TEMPLATE_BLOCKS_MAX} lines. Remove one to add another.` };
  }
  if (type === "qr" && t.blocks.filter((block) => block.type === "qr").length >= PRINT_QR_BLOCKS_MAX) {
    return { ok: false, reason: `A design can have up to ${PRINT_QR_BLOCKS_MAX} QR codes. Remove one to add another.` };
  }
  return { ok: true };
}

// A new line's id is "<type>-<n>": one past the highest n in use, else (past the id ceiling) the smallest free n.
function nextRepeatId(t: EditableTemplate, type: RepeatableBlockType): string {
  const prefix = `${type}-`;
  const used = new Set<number>();
  for (const block of t.blocks) {
    if (block.type !== type || !block.id.startsWith(prefix)) continue;
    const n = Number(block.id.slice(prefix.length));
    if (Number.isInteger(n) && n > 0) used.add(n);
  }
  const highest = used.size === 0 ? 0 : Math.max(...used);
  if (highest < PRINT_REPEAT_INDEX_MAX) return `${prefix}${highest + 1}`;
  let n = 1;
  while (used.has(n)) n += 1;
  return `${prefix}${n}`;
}

function newRepeatable(type: RepeatableBlockType, id: string, upiId: string | null | undefined, allowUpi: boolean): EditableBlock {
  switch (type) {
    case "divider":
      return { id, type, on: true };
    case "customText":
      // Empty on purpose: the editor opens it for typing, and the save gate asks for the text.
      return { id, type, on: true, options: { text: "" } };
    case "qr":
      return {
        id,
        type,
        on: true,
        options: allowUpi && isValidUpiId(upiId ?? "") ? { content: "upi" } : { content: "link", url: "" },
      };
  }
}

/**
 * Adds one line at the end. Call addCheck first: this does not refuse a cap. `allowUpi` false (the kitchen ticket:
 * a pay QR has no amount to pay there) starts every new QR as an empty link.
 */
export function addRepeatable<T extends EditableTemplate>(
  t: T,
  type: RepeatableBlockType,
  settings: { upiId?: string | null } | null | undefined,
  allowUpi = true,
): { template: T; id: string } {
  const id = nextRepeatId(t, type);
  return { template: { ...t, blocks: [...t.blocks, newRepeatable(type, id, settings?.upiId, allowUpi)] }, id };
}

/** Only a repeatable line can be removed; every other line is switched off instead. */
export function removeBlock<T extends EditableTemplate>(t: T, id: string): T {
  const block = t.blocks.find((b) => b.id === id);
  if (!block || !isRepeatableBlockType(block.type)) return t;
  return { ...t, blocks: t.blocks.filter((b) => b.id !== id) };
}
