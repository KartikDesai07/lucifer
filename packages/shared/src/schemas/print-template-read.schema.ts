import { z } from "zod";
import { PRINT_FONT_SIZES } from "../constants";
import {
  BILL_DESIGNS,
  KOT_DESIGNS,
  PRINT_FONT_KEYS,
  PRINT_TEMPLATE_VERSION,
  TOKEN_DESIGNS,
  isValidBlockId,
  type BillTemplate,
  type KotTemplate,
  type TokenTemplate,
} from "../print-template";
import { blockSchemasFor, limitsFor, type TemplateLimits } from "./print-template-blocks.schema";

export { PRINT_TEMPLATE_READ_LIMITS } from "./print-template-blocks.schema";

// The READ schemas of the three slip templates (print customization S1, 01-PLAN §2.1 + A1), in their own module
// since R6 (A4): the client's resolver (apps/cafe lib/print-template-resolve.ts) imports only this file, so a
// receipt bundle never builds the WRITE gate. print-template.schema.ts builds that gate from the same shapes and
// re-exports everything here.
//
// READ (...TemplateReadSchema): the same shape as WRITE, well-formed and unique ids, and the QR cap, but at its
// OWN frozen ceilings (PRINT_TEMPLATE_READ_LIMITS) and with no content rule and no presence check. NEVER narrow
// it once S2 stores data: a stored template that stops parsing silently falls back to the Classic slip. Any new
// rule or tighter cap goes on the WRITE gate (...TemplateSchema) instead.

const templateCommon = {
  v: z.literal(PRINT_TEMPLATE_VERSION),
  font: z.enum(PRINT_FONT_KEYS),
  size: z.enum(PRINT_FONT_SIZES),
};

// The rules that look across blocks: well-formed ids, no duplicate id, the QR cap. Issues carry the failing
// block's path so the editor can mark the exact line.
function checkBlocks(blocks: readonly { type: string; id: string }[], qrMax: number, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  let qrCount = 0;
  blocks.forEach((block, index) => {
    if (!isValidBlockId(block.type, block.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks", index, "id"],
        message: "This line is out of date. Reload the page and try again",
      });
    }
    if (seen.has(block.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks", index, "id"],
        message: "Two lines are the same. Remove one",
      });
    }
    seen.add(block.id);
    if (block.type === "qr") {
      qrCount += 1;
      if (qrCount > qrMax) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["blocks", index], message: `Use at most ${qrMax} QR codes` });
      }
    }
  });
}

const tooMany = (max: number): string => `Keep it under ${max + 1} lines`;

/** One mode's block unions (blockSchemasFor). Both modes build the same shape, so they share this type. */
export type TemplateBlockSchemas = ReturnType<typeof blockSchemasFor>;

// One template's schema over one mode's blocks and limits, without the presence check (the WRITE gate adds it).

export function billTemplateShape(blocks: TemplateBlockSchemas, limits: TemplateLimits) {
  return z
    .object({
      ...templateCommon,
      design: z.enum(BILL_DESIGNS),
      blocks: z.array(blocks.bill).max(limits.blocks, tooMany(limits.blocks)),
    })
    .strict()
    .superRefine((template, ctx) => checkBlocks(template.blocks, limits.qrBlocks, ctx));
}

export function kotTemplateShape(blocks: TemplateBlockSchemas, limits: TemplateLimits) {
  return z
    .object({
      ...templateCommon,
      design: z.enum(KOT_DESIGNS),
      blocks: z.array(blocks.kot).max(limits.blocks, tooMany(limits.blocks)),
    })
    .strict()
    .superRefine((template, ctx) => checkBlocks(template.blocks, limits.qrBlocks, ctx));
}

export function tokenTemplateShape(blocks: TemplateBlockSchemas, limits: TemplateLimits) {
  return z
    .object({
      ...templateCommon,
      design: z.enum(TOKEN_DESIGNS),
      blocks: z.array(blocks.token).max(limits.blocks, tooMany(limits.blocks)),
    })
    .strict()
    .superRefine((template, ctx) => checkBlocks(template.blocks, limits.qrBlocks, ctx));
}

const READ_BLOCKS = blockSchemasFor("read");
const READ_LIMITS = limitsFor("read");

export const billTemplateReadSchema: z.ZodType<BillTemplate> = billTemplateShape(READ_BLOCKS, READ_LIMITS);
export const kotTemplateReadSchema: z.ZodType<KotTemplate> = kotTemplateShape(READ_BLOCKS, READ_LIMITS);
export const tokenTemplateReadSchema: z.ZodType<TokenTemplate> = tokenTemplateShape(READ_BLOCKS, READ_LIMITS);
