import { z } from "zod";
import { PRINT_LOGO_SIZES } from "../constants";
import {
  BILL_BLOCK_TYPES,
  BLOCK_ALIGNS,
  BLOCK_SIZES,
  DIVIDER_STYLES,
  KOT_BLOCK_TYPES,
  PRINT_CUSTOM_TEXT_MAX,
  PRINT_QR_BLOCKS_MAX,
  PRINT_QR_CAPTION_MAX,
  PRINT_QR_URL_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
  TOKEN_BLOCK_TYPES,
} from "../print-template";
import { isSafeHttpsLink } from "../print-qr";

// Split out of print-template.schema.ts (300-line budget): the per-block schemas and the per-kind block
// unions. Strict at every level: a key this version does not know is rejected, never silently saved.
//
// Two modes. WRITE is the save gate: every rule and the PRINT_* caps. READ parses what is already stored: the
// same SHAPE (strict objects, enums, unions) but its own frozen ceilings and no content rules, so a later
// slice tightening a write rule can never turn a stored template unreadable.
export type TemplateMode = "read" | "write";

// The READ ceilings. Roomy but still bounded. They may only ever GROW: lowering one could make a template
// that is already stored stop parsing (and a stored template that stops parsing silently prints as Classic).
export const PRINT_TEMPLATE_READ_LIMITS = {
  blocks: 64,
  customText: 240,
  qrUrl: 400,
  qrCaption: 120,
  qrBlocks: 8,
} as const;

export interface TemplateLimits {
  blocks: number;
  customText: number;
  qrUrl: number;
  qrCaption: number;
  qrBlocks: number;
}

const WRITE_LIMITS: TemplateLimits = {
  blocks: PRINT_TEMPLATE_BLOCKS_MAX,
  customText: PRINT_CUSTOM_TEXT_MAX,
  qrUrl: PRINT_QR_URL_MAX,
  qrCaption: PRINT_QR_CAPTION_MAX,
  qrBlocks: PRINT_QR_BLOCKS_MAX,
};

export function limitsFor(mode: TemplateMode): TemplateLimits {
  return mode === "write" ? WRITE_LIMITS : PRINT_TEMPLATE_READ_LIMITS;
}

// WRITE trims; READ takes the stored string as it is. Both are a plain ZodString so the two modes share a type.
const textOf = (mode: TemplateMode) => (mode === "write" ? z.string().trim() : z.string());

// The one level of the block that every type shares. Absent style = "the design's own markup for this line".
const blockCommon = {
  id: z.string(),
  on: z.boolean(),
  align: z.enum(BLOCK_ALIGNS).optional(),
  size: z.enum(BLOCK_SIZES).optional(),
  bold: z.boolean().optional(),
};

const logoBlockSchema = z
  .object({
    ...blockCommon,
    type: z.literal("logo"),
    options: z.object({ logoSize: z.enum(PRINT_LOGO_SIZES) }).strict(),
  })
  .strict();

const dividerBlockSchema = z
  .object({
    ...blockCommon,
    type: z.literal("divider"),
    // Absent options = the design's own divider.
    options: z.object({ style: z.enum(DIVIDER_STYLES) }).strict().optional(),
  })
  .strict();

function customTextBlockSchema(mode: TemplateMode) {
  const max = limitsFor(mode).customText;
  return z
    .object({
      ...blockCommon,
      type: z.literal("customText"),
      options: z
        .object({
          // READ has no minimum: it never rejects what the save gate once accepted.
          text: textOf(mode)
            .min(mode === "write" ? 1 : 0, "Type some text")
            .max(max, `Keep it under ${max} characters`),
        })
        .strict(),
    })
    .strict();
}

const QR_URL_PROBLEM = "Use a link that starts with https:// (no spaces or special characters)";

function qrCaption(mode: TemplateMode) {
  const max = limitsFor(mode).qrCaption;
  return textOf(mode)
    .min(mode === "write" ? 1 : 0, "Type a caption or remove it")
    .max(max, `Keep the caption under ${max} characters`)
    .optional();
}

// READ keeps only the length ceiling on the link: no character rule, no URL parse (the parser differs by
// device, and a save-time rule must not decide whether a stored slip can still print).
function linkQrOptionsSchema(mode: TemplateMode) {
  const max = limitsFor(mode).qrUrl;
  return z
    .object({
      content: z.literal("link"),
      url: textOf(mode)
        .max(max, `Keep the link under ${max} characters`)
        .refine((value) => mode === "read" || isSafeHttpsLink(value), QR_URL_PROBLEM),
      caption: qrCaption(mode),
    })
    .strict();
}

// "upi" pays the cafe's own UPI id, so it carries no link; only the bill has an amount to pay (A1.1).
function upiQrOptionsSchema(mode: TemplateMode) {
  return z.object({ content: z.literal("upi"), caption: qrCaption(mode) }).strict();
}

function billQrBlockSchema(mode: TemplateMode) {
  return z
    .object({
      ...blockCommon,
      type: z.literal("qr"),
      options: z.discriminatedUnion("content", [upiQrOptionsSchema(mode), linkQrOptionsSchema(mode)]),
    })
    .strict();
}

// The kitchen ticket's and the token slip's QR is a link only.
function linkQrBlockSchema(mode: TemplateMode) {
  return z.object({ ...blockCommon, type: z.literal("qr"), options: linkQrOptionsSchema(mode) }).strict();
}

// The kitchen ticket's item list: all three switches are always saved, never left to a default.
const kotItemsBlockSchema = z
  .object({
    ...blockCommon,
    type: z.literal("items"),
    options: z
      .object({ prices: z.boolean(), modifiers: z.boolean(), instructions: z.boolean() })
      .strict(),
  })
  .strict();

// The plain types of a kind: its catalog minus the types that carry options. Returned as a non-empty tuple
// because z.enum needs one; an empty result would mean the catalog is broken, so it throws at import time.
function plainTypesOf<T extends string, O extends string>(
  catalog: readonly T[],
  optioned: readonly O[],
): [Exclude<T, O>, ...Exclude<T, O>[]] {
  const skip = new Set<string>(optioned);
  const kept = catalog.filter((type): type is Exclude<T, O> => !skip.has(type));
  const [first, ...rest] = kept;
  if (first === undefined) throw new Error("A block catalog needs at least one plain type");
  return [first, ...rest];
}

function plainBlockSchema<T extends string>(types: [T, ...T[]]) {
  return z.object({ ...blockCommon, type: z.enum(types) }).strict();
}

const OPTIONED_COMMON = ["logo", "divider", "customText", "qr"] as const;

// The bill has more plain types than TypeScript will check against the hand-written block union in one step
// (it gives up on a discriminant of more than 25 literals), so they go in two groups. The first group is
// listed here; the second is derived as the catalog minus the optioned types minus the first, so a type
// added to the catalog lands in the second group on its own.
type OptionedType = (typeof OPTIONED_COMMON)[number];
const BILL_PLAIN_FIRST_GROUP = [
  "name", "tagline", "address", "phone", "gstin", "fssai", "headerText", "title", "cancelBanner", "billNo",
  "token", "orderId", "dateTime", "table",
] as const satisfies readonly Exclude<(typeof BILL_BLOCK_TYPES)[number], OptionedType>[];

const billPlain = [
  plainBlockSchema(plainTypesOf(BILL_PLAIN_FIRST_GROUP, [])),
  plainBlockSchema(plainTypesOf(BILL_BLOCK_TYPES, [...OPTIONED_COMMON, ...BILL_PLAIN_FIRST_GROUP])),
] as const;
const kotPlain = plainBlockSchema(plainTypesOf(KOT_BLOCK_TYPES, [...OPTIONED_COMMON, "items"] as const));
const tokenPlain = plainBlockSchema(plainTypesOf(TOKEN_BLOCK_TYPES, OPTIONED_COMMON));

/** The per-kind block unions for one mode. The two modes build the same shape, so they share one type. */
export function blockSchemasFor(mode: TemplateMode) {
  return {
    bill: z.discriminatedUnion("type", [
      logoBlockSchema,
      dividerBlockSchema,
      customTextBlockSchema(mode),
      billQrBlockSchema(mode),
      ...billPlain,
    ]),
    kot: z.discriminatedUnion("type", [
      logoBlockSchema,
      dividerBlockSchema,
      customTextBlockSchema(mode),
      linkQrBlockSchema(mode),
      kotItemsBlockSchema,
      kotPlain,
    ]),
    token: z.discriminatedUnion("type", [
      logoBlockSchema,
      dividerBlockSchema,
      customTextBlockSchema(mode),
      linkQrBlockSchema(mode),
      tokenPlain,
    ]),
  };
}
