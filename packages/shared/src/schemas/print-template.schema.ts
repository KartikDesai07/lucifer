import { z } from "zod";
import {
  BILL_REQUIRED_BLOCKS,
  KOT_REQUIRED_BLOCKS,
  TOKEN_REQUIRED_BLOCKS,
  type BillTemplate,
  type KotTemplate,
  type TokenTemplate,
} from "../print-template";
import { blockSchemasFor, limitsFor } from "./print-template-blocks.schema";
import { billTemplateShape, kotTemplateShape, tokenTemplateShape } from "./print-template-read.schema";

export { PRINT_TEMPLATE_READ_LIMITS } from "./print-template-blocks.schema";
export { billTemplateReadSchema, kotTemplateReadSchema, tokenTemplateReadSchema } from "./print-template-read.schema";

// Print customization S1 (01-PLAN §2.1 + A1): the schemas for the three slip templates, each in two forms.
// The hand-written types in print-template.ts are the contract; every schema below is annotated with its type,
// so a drift between the two is a compile error, not a stored surprise. Strict at every level (see
// print-template-blocks.schema.ts for the blocks): a template is stored whole, so there is no partial form.
//
// READ schemas (...TemplateReadSchema) live in print-template-read.schema.ts since R6 (the client's resolver
// imports only that module) and are re-exported here; the rule that they are never narrowed is stated there.
// This module is the WRITE gate (...TemplateSchema): the same shapes over the WRITE blocks and caps, plus the
// presence check below.

// "cancelBanner" -> "cancel banner", for the sentence the owner reads.
function plainName(type: string): string {
  return type.replace(/([A-Z])/g, " $1").toLowerCase();
}

// Write gate only: every line the slip must keep has to be present, or its lock could be dodged by deleting it.
function checkRequired(blocks: readonly { type: string }[], required: readonly string[], ctx: z.RefinementCtx): void {
  const present = new Set(blocks.map((block) => block.type));
  for (const type of required) {
    if (!present.has(type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["blocks"],
        message: `The ${plainName(type)} line has to stay on this slip`,
      });
    }
  }
}

const WRITE_BLOCKS = blockSchemasFor("write");
const WRITE_LIMITS = limitsFor("write");

// The write gate: every WRITE rule and cap, plus the required-presence check.
export const billTemplateSchema: z.ZodType<BillTemplate> = billTemplateShape(WRITE_BLOCKS, WRITE_LIMITS).superRefine(
  (template, ctx) => checkRequired(template.blocks, BILL_REQUIRED_BLOCKS, ctx),
);
export const kotTemplateSchema: z.ZodType<KotTemplate> = kotTemplateShape(WRITE_BLOCKS, WRITE_LIMITS).superRefine(
  (template, ctx) => checkRequired(template.blocks, KOT_REQUIRED_BLOCKS, ctx),
);
export const tokenTemplateSchema: z.ZodType<TokenTemplate> = tokenTemplateShape(WRITE_BLOCKS, WRITE_LIMITS).superRefine(
  (template, ctx) => checkRequired(template.blocks, TOKEN_REQUIRED_BLOCKS, ctx),
);
