// Print customization S1 (01-PLAN §2.1 + Amendment A1): the slip-template contract. Pure and client-safe.
// A template is stored whole on the Settings singleton (billTemplate / kotTemplate / tokenTemplate, S2), so the
// kind is implied by the field it sits under. ABSENT means today's legacy bill / kitchen ticket, byte for byte,
// forever. The Zod gate for writes lives in schemas/print-template.schema.ts.
import type { PrintFontSize, PrintLogoSize } from "./constants";

export const PRINT_TEMPLATE_VERSION = 1;

export const PRINT_TEMPLATE_KINDS = ["bill", "kot", "token"] as const;
export type PrintTemplateKind = (typeof PRINT_TEMPLATE_KINDS)[number];

export const BILL_DESIGNS = ["classic", "modern", "express", "cafe"] as const;
export type BillDesign = (typeof BILL_DESIGNS)[number];
export const KOT_DESIGNS = ["classic", "kitchenBold"] as const;
export type KotDesign = (typeof KOT_DESIGNS)[number];
export const TOKEN_DESIGNS = ["bigNumber", "numberItems"] as const;
export type TokenDesign = (typeof TOKEN_DESIGNS)[number];

// The slip's base face. "geistMono" is the legacy slip's own face (the root's `font-mono` class resolves to
// Geist Mono via lib/fonts.ts), so Classic keeps it. The other keys are the curated self-hosted faces S3 ships
// (01-PLAN §2.5); a display face is a design's emphasis token, never a base font, so it is not listed here.
export const PRINT_FONT_KEYS = ["geistMono", "mono", "sans", "condensed", "slab"] as const;
export type PrintFontKey = (typeof PRINT_FONT_KEYS)[number];
export const CLASSIC_PRINT_FONT: PrintFontKey = "geistMono";

// Per-line style. Every one is optional: absent means "the design's own markup for this line", which is how
// Classic-from-legacy reproduces today's exact classes (the golden test). Applied by the design themes (S3).
export const BLOCK_ALIGNS = ["left", "center", "right"] as const;
export type BlockAlign = (typeof BLOCK_ALIGNS)[number];
export const BLOCK_SIZES = ["xs", "sm", "md", "lg", "xl"] as const;
export type BlockSize = (typeof BLOCK_SIZES)[number];

// "ornament" (S3) is a short centred dot-and-diamond rule, the Cafe design's own divider, offered in every design.
export const DIVIDER_STYLES = ["dashed", "solid", "double", "blank", "ornament"] as const;
export type DividerStyle = (typeof DIVIDER_STYLES)[number];
export const QR_CONTENTS = ["upi", "link"] as const;
export type QrContent = (typeof QR_CONTENTS)[number];

/** A template is saved whole into the Settings singleton; this bounds it to a few KB. */
export const PRINT_TEMPLATE_BLOCKS_MAX = 40;
export const PRINT_CUSTOM_TEXT_MAX = 120;
/** Amendment A1.1: a QR line is repeatable, capped. */
export const PRINT_QR_BLOCKS_MAX = 3;
/** A longer link makes a denser QR than a 2-px module survives on 58 mm paper. */
export const PRINT_QR_URL_MAX = 200;
export const PRINT_QR_CAPTION_MAX = 60;
/** Upper bound on a repeatable block's "-n" suffix — well above PRINT_TEMPLATE_BLOCKS_MAX. */
export const PRINT_REPEAT_INDEX_MAX = 999;

// Blocks that may appear more than once. Their id is "<type>-<n>"; every other block's id IS its type, which
// (with unique ids) is what keeps a non-repeatable line from appearing twice. No crypto.randomUUID: older
// WebViews lack it.
export const REPEATABLE_BLOCK_TYPES = ["divider", "customText", "qr"] as const;
export type RepeatableBlockType = (typeof REPEATABLE_BLOCK_TYPES)[number];

// Block catalogs, kind -> types (01-PLAN §2.1 + A1.1). The order here is catalog order, not print order — a
// template's `blocks` array is the print order. Bill: cancelReason is the cancelled bill's "Reason:" line;
// taxes is the exclusive-GST line printed before the charges, taxIncluded the inclusive-GST note printed after
// the total (both read the order's own GST snapshot, so exactly one of them prints on a GST bill).
export const BILL_BLOCK_TYPES = [
  "logo", "name", "tagline", "address", "phone", "gstin", "fssai", "headerText", "title", "cancelBanner",
  "billNo", "token", "orderId", "dateTime", "table", "customer", "cashier", "cancelReason", "items",
  "subtotal", "discount", "taxes", "charges", "total", "taxIncluded", "payment", "due", "loyalty",
  "footerText", "printedAt", "qr", "divider", "customText",
] as const;
export type BillBlockType = (typeof BILL_BLOCK_TYPES)[number];

// KOT: title prints "KITCHEN ORDER", or the VOID / TABLE MOVED banner in those variants. station is the empty
// slot the office PC's Phase 2 fills (stationLine).
export const KOT_BLOCK_TYPES = [
  "logo", "name", "title", "station", "kotNo", "token", "roundLabel", "orderId", "table", "time", "staff",
  "voidReason", "items", "notes", "itemCount", "roundTotal", "qr", "divider", "customText",
] as const;
export type KotBlockType = (typeof KOT_BLOCK_TYPES)[number];

export const TOKEN_BLOCK_TYPES = [
  "name", "logo", "tokenNo", "label", "dateTime", "items", "message", "qr", "divider", "customText",
] as const;
export type TokenBlockType = (typeof TOKEN_BLOCK_TYPES)[number];

// ── Blocks ───────────────────────────────────────────────────────────────────

interface BlockCommon {
  id: string;
  on: boolean;
  align?: BlockAlign;
  size?: BlockSize;
  bold?: boolean;
}

export interface PlainBlock<T extends string> extends BlockCommon {
  type: T;
}

export interface LogoOptions {
  logoSize: PrintLogoSize;
}
export interface LogoBlock extends BlockCommon {
  type: "logo";
  options: LogoOptions;
}

/** Absent options = the design's own divider. */
export interface DividerOptions {
  style: DividerStyle;
}
export interface DividerBlock extends BlockCommon {
  type: "divider";
  options?: DividerOptions;
}

export interface CustomTextOptions {
  text: string;
}
export interface CustomTextBlock extends BlockCommon {
  type: "customText";
  options: CustomTextOptions;
}

/** Pays the cafe's UPI id (S3). Bill only (A1.1): a kitchen or token slip has no amount to pay. */
export interface UpiQrOptions {
  content: "upi";
  caption?: string;
}
/** A menu / review / Instagram / website link: an https URL in visible ASCII (no invisible pasted characters). */
export interface LinkQrOptions {
  content: "link";
  url: string;
  caption?: string;
}
export type QrOptions = UpiQrOptions | LinkQrOptions;
export interface QrBlock extends BlockCommon {
  type: "qr";
  options: QrOptions;
}
/** The kitchen ticket's and the token slip's QR: a link only. */
export interface LinkQrBlock extends BlockCommon {
  type: "qr";
  options: LinkQrOptions;
}

/** The kitchen ticket's item list: per-line amounts (legacy kotShowPrices), modifier lines, instructions. */
export interface KotItemsOptions {
  prices: boolean;
  modifiers: boolean;
  instructions: boolean;
}
export interface KotItemsBlock extends BlockCommon {
  type: "items";
  options: KotItemsOptions;
}

type CommonBlockOf<T extends string, Q> = T extends "logo"
  ? LogoBlock
  : T extends "divider"
    ? DividerBlock
    : T extends "customText"
      ? CustomTextBlock
      : T extends "qr"
        ? Q
        : PlainBlock<T>;

/** The block shape for one type of a kind; distributes over a union of types. */
export type BillBlockOf<T extends BillBlockType> = CommonBlockOf<T, QrBlock>;
export type KotBlockOf<T extends KotBlockType> = T extends "items" ? KotItemsBlock : CommonBlockOf<T, LinkQrBlock>;
export type TokenBlockOf<T extends TokenBlockType> = CommonBlockOf<T, LinkQrBlock>;

export type BillBlock = BillBlockOf<BillBlockType>;
export type KotBlock = KotBlockOf<KotBlockType>;
export type TokenBlock = TokenBlockOf<TokenBlockType>;

// ── Templates ────────────────────────────────────────────────────────────────

interface TemplateCommon {
  v: typeof PRINT_TEMPLATE_VERSION;
  font: PrintFontKey;
  /** The slip's base type size; every line sizes itself in em against it. Paper width is NOT here (C6). */
  size: PrintFontSize;
}

export interface BillTemplate extends TemplateCommon {
  design: BillDesign;
  blocks: BillBlock[];
}
export interface KotTemplate extends TemplateCommon {
  design: KotDesign;
  blocks: KotBlock[];
}
export interface TokenTemplate extends TemplateCommon {
  design: TokenDesign;
  blocks: TokenBlock[];
}

// ── Ids ──────────────────────────────────────────────────────────────────────

export function isRepeatableBlockType(type: string): type is RepeatableBlockType {
  return (REPEATABLE_BLOCK_TYPES as readonly string[]).includes(type);
}

const REPEAT_INDEX_RE = /^[1-9][0-9]*$/;

/** A non-repeatable block's id is its type; a repeatable one's is "<type>-<n>", n in 1..PRINT_REPEAT_INDEX_MAX. */
export function isValidBlockId(type: string, id: string): boolean {
  if (!isRepeatableBlockType(type)) return id === type;
  const prefix = `${type}-`;
  if (!id.startsWith(prefix)) return false;
  const index = id.slice(prefix.length);
  return REPEAT_INDEX_RE.test(index) && Number(index) <= PRINT_REPEAT_INDEX_MAX;
}

// ── Locks (01-PLAN §2.7; legal text is SECONDARY per 02b §0, so these are reversible named constants) ──
// A locked block prints even when the template turns it off. Enforced at RENDER time on the template path only
// (a legacy cafe that turned GSTIN off keeps printing exactly as today until it saves a template). A lock acts
// only on a block the template contains; the REQUIRED lists below (every lockable block) are what the WRITE
// schema keeps present, so a lock cannot be dodged by deleting the line. The READ schema never checks presence:
// a lock or a required block added in a later slice must not turn a stored template unreadable (the S2 resolver
// re-inserts a missing required block instead). Locks are render-time only, so changing one never breaks a read.

export interface SlipLockContext {
  /** The order's own GST snapshot shows tax (receiptGst(order, cfg).show). */
  gst: boolean;
  /** Settings carries a non-empty FSSAI licence number. */
  fssai: boolean;
  /** The kitchen slip is a VOID or TABLE MOVED slip. */
  banner: boolean;
}

interface LockTable<T extends string> {
  always: readonly T[];
  withGst: readonly T[];
  withFssai: readonly T[];
  withBanner: readonly T[];
}

export const BILL_LOCKS: LockTable<BillBlockType> = {
  always: ["name", "dateTime", "items", "total", "cancelBanner", "cancelReason"],
  withGst: ["billNo", "orderId", "gstin", "address", "taxes", "taxIncluded", "title"],
  withFssai: ["fssai"],
  withBanner: [],
};

export const KOT_LOCKS: LockTable<KotBlockType> = {
  always: [],
  withGst: [],
  withFssai: [],
  // A cook must never mistake a void or moved slip for a fresh ticket (title), and must be able to act on it (owner,
  // s79): a void slip names the dishes to stop and their table; a moved slip names FROM → TO (it lists no dishes —
  // the renderers keep that rule, so `items` prints nothing on a moved slip even while locked).
  withBanner: ["title", "table", "items"],
};

export const TOKEN_LOCKS: LockTable<TokenBlockType> = {
  always: ["tokenNo"],
  withGst: [],
  withFssai: [],
  withBanner: [],
};

function lockedBy<T extends string>(table: LockTable<T>, type: T, ctx: SlipLockContext): boolean {
  return (
    table.always.includes(type) ||
    (ctx.gst && table.withGst.includes(type)) ||
    (ctx.fssai && table.withFssai.includes(type)) ||
    (ctx.banner && table.withBanner.includes(type))
  );
}

export function billBlockLocked(type: BillBlockType, ctx: SlipLockContext): boolean {
  return lockedBy(BILL_LOCKS, type, ctx);
}
export function kotBlockLocked(type: KotBlockType, ctx: SlipLockContext): boolean {
  return lockedBy(KOT_LOCKS, type, ctx);
}
export function tokenBlockLocked(type: TokenBlockType, ctx: SlipLockContext): boolean {
  return lockedBy(TOKEN_LOCKS, type, ctx);
}

/** Blocks a saved template must contain: every lockable one (the write gate; see above). */
// Derived from all four cells, so a lock added to any cell is required on save without a second edit.
function requiredOf<T extends string>(table: LockTable<T>): readonly T[] {
  return [...new Set([...table.always, ...table.withGst, ...table.withFssai, ...table.withBanner])];
}
export const BILL_REQUIRED_BLOCKS: readonly BillBlockType[] = requiredOf(BILL_LOCKS);
export const KOT_REQUIRED_BLOCKS: readonly KotBlockType[] = requiredOf(KOT_LOCKS);
export const TOKEN_REQUIRED_BLOCKS: readonly TokenBlockType[] = requiredOf(TOKEN_LOCKS);
