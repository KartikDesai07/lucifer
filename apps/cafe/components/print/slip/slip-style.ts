import type { BlockAlign, BlockSize } from "@pos/shared/print-template";

// A block's own size / align / bold (print customization S3, 01-PLAN §2.6). Whole literal class names: Tailwind
// scans source text. Sizes are RELATIVE (em), so a block's own em classes compound: "lg" on a line that is
// already 0.83em prints at 1.25 x 0.83.
export const BLOCK_SIZE_CLASS: Record<BlockSize, string> = {
  xs: "text-[0.75em]",
  sm: "text-[0.875em]",
  md: "text-[1em]",
  lg: "text-[1.25em]",
  xl: "text-[1.5em]",
};

// Alignment and weight are forced onto the block's descendants too ([&_*]): a line's own `text-center` or
// `font-bold` would otherwise beat the wrapper's class, and the person's choice must win.
export const BLOCK_ALIGN_CLASS: Record<BlockAlign, string> = {
  left: "text-left [&_*]:text-left",
  center: "text-center [&_*]:text-center",
  right: "text-right [&_*]:text-right",
};

export const BOLD_CLASS = "font-bold [&_*]:font-bold";
// "Not bold" is the design's regular weight (the same forcing): Classic's own is normal, a thermal-first design's
// is medium (a lighter face drops out of a 1-bit print).
export const CLASSIC_REGULAR_CLASS = "font-normal [&_*]:font-normal";
export const THEMED_REGULAR_CLASS = "font-medium [&_*]:font-medium";

// 01-PLAN §2.7: a locked line cannot be shrunk below "sm". Render-time only, never a schema rule.
const LOCKED_MIN_SIZE: BlockSize = "sm";

export interface BlockStyleFields {
  size?: BlockSize;
  align?: BlockAlign;
  bold?: boolean;
}

/** The wrapper's classes, or null when the block sets none (Classic's legacy lines then stay byte-identical). */
export function blockStyleClass(block: BlockStyleFields, locked: boolean, regularClass: string): string | null {
  const size = locked && block.size === "xs" ? LOCKED_MIN_SIZE : block.size;
  const classes = [
    size === undefined ? "" : BLOCK_SIZE_CLASS[size],
    block.align === undefined ? "" : BLOCK_ALIGN_CLASS[block.align],
    block.bold === undefined ? "" : block.bold ? BOLD_CLASS : regularClass,
  ].filter((c) => c !== "");
  return classes.length === 0 ? null : classes.join(" ");
}
