import type { z } from "zod";

import {
  BILL_REQUIRED_BLOCKS,
  KOT_REQUIRED_BLOCKS,
  TOKEN_REQUIRED_BLOCKS,
  isRepeatableBlockType,
  type BillTemplate,
  type KotTemplate,
  type TokenTemplate,
} from "@pos/shared/print-template";
import {
  billTemplateReadSchema,
  kotTemplateReadSchema,
  tokenTemplateReadSchema,
} from "@pos/shared/schemas/print-template-read.schema";
import {
  TOKEN_DEFAULT_DESIGN,
  defaultBillTemplate,
  defaultKotTemplate,
  defaultTokenTemplate,
} from "@/lib/print-template-designs";
import type { Settings } from "@/types";

// The ONLY reader of a stored slip template (print customization S2, 01-PLAN §2.1 + Amendment A2). Settings
// stores it as Mongoose Mixed, so it is re-parsed here with the READ schema on every read, and nothing in it is
// trusted before that. It never throws:
//   - absent (or null)  -> "none": today's legacy slip, byte for byte;
//   - fails READ        -> "unreadable": the legacy slip too (the S4 editor shows "Your saved design could not
//                          be read; showing Classic", R9). Whole-template fallback, not block salvage: every
//                          design, font and block type S3-S9 print is already in the S1 enums, so an unknown
//                          member means a corrupt or foreign document, not a newer deploy;
//   - reads             -> "ok": the template, with any missing REQUIRED block put back (below).

export type SlipTemplateRead<T> = { state: "none" } | { state: "unreadable" } | { state: "ok"; template: T };

type SettingsArg = Settings | null | undefined;

interface BlockLike {
  id: string;
  type: string;
  on: boolean;
}

// The READ schema never checks presence, so a template saved before a block became required still parses.
// Each missing required block is re-inserted OFF (its lock alone decides whether it prints), which is what
// lets a lock or required block added in a later slice bite on templates already stored. It goes right after
// its nearest preceding neighbour in the design's default order that the template has (repeatable lines are
// skipped: their ids carry no position), else first. The order is the TEMPLATE'S OWN design's default list
// (lib/print-template-designs.ts; Classic's is the converter's).
export function withRequiredBlocks<B extends BlockLike>(
  blocks: B[],
  required: readonly string[],
  defaultOrder: () => readonly B[],
): B[] {
  const present = new Set(blocks.map((block) => block.type));
  if (required.every((type) => present.has(type))) return blocks;

  const out = [...blocks];
  const order = defaultOrder();
  order.forEach((block, index) => {
    if (!required.includes(block.type) || present.has(block.type)) return;
    let at = 0;
    for (let i = index - 1; i >= 0; i--) {
      const neighbour = order[i].type;
      if (isRepeatableBlockType(neighbour)) continue;
      const found = out.findIndex((b) => b.type === neighbour);
      if (found !== -1) {
        at = found + 1;
        break;
      }
    }
    out.splice(at, 0, { ...block, on: false });
    present.add(block.type);
  });
  return out;
}

function readSlip<T extends { blocks: BlockLike[] }>(
  raw: unknown,
  schema: z.ZodType<T>,
  fill: (template: T) => T,
): SlipTemplateRead<T> {
  if (raw === undefined || raw === null) return { state: "none" };
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { state: "unreadable" };
  return { state: "ok", template: fill(parsed.data) };
}

export function readBillTemplate(settings: SettingsArg): SlipTemplateRead<BillTemplate> {
  return readSlip(settings?.billTemplate, billTemplateReadSchema, (template) => ({
    ...template,
    blocks: withRequiredBlocks(template.blocks, BILL_REQUIRED_BLOCKS, () => defaultBillTemplate(template.design, settings).blocks),
  }));
}

export function readKotTemplate(settings: SettingsArg): SlipTemplateRead<KotTemplate> {
  return readSlip(settings?.kotTemplate, kotTemplateReadSchema, (template) => ({
    ...template,
    blocks: withRequiredBlocks(template.blocks, KOT_REQUIRED_BLOCKS, () => defaultKotTemplate(template.design, settings).blocks),
  }));
}

/** The bill template to print through the block engine, or null for the legacy OrderReceipt. */
export function billTemplateOf(settings: SettingsArg): BillTemplate | null {
  const read = readBillTemplate(settings);
  return read.state === "ok" ? read.template : null;
}

/** The kitchen-ticket template to print through the block engine, or null for the legacy KOTReceipt. */
export function kotTemplateOf(settings: SettingsArg): KotTemplate | null {
  const read = readKotTemplate(settings);
  return read.state === "ok" ? read.template : null;
}

export function readTokenTemplate(settings: SettingsArg): SlipTemplateRead<TokenTemplate> {
  return readSlip(settings?.tokenTemplate, tokenTemplateReadSchema, (template) => ({
    ...template,
    blocks: withRequiredBlocks(template.blocks, TOKEN_REQUIRED_BLOCKS, () => defaultTokenTemplate(template.design, settings).blocks),
  }));
}

/**
 * The token template to print. NEVER null: a token has no legacy slip, so a cafe with no stored token design, or one
 * whose stored design cannot be read, prints the default (Big Number, owner decision S7).
 */
export function tokenTemplateOf(settings: SettingsArg): TokenTemplate {
  const read = readTokenTemplate(settings);
  return read.state === "ok" ? read.template : defaultTokenTemplate(TOKEN_DEFAULT_DESIGN, settings);
}
