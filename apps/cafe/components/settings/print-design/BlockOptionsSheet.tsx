"use client";

import { Trash2 } from "lucide-react";

import {
  BLOCK_ALIGNS,
  BLOCK_SIZES,
  DIVIDER_STYLES,
  PRINT_CUSTOM_TEXT_MAX,
  isRepeatableBlockType,
  type BlockAlign,
  type BlockSize,
  type DividerStyle,
  type QrOptions,
} from "@pos/shared/print-template";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { PRINT_LOGO_SIZES, type PrintLogoSize } from "@/lib/constants";
import {
  removeBlock,
  setBlockStyle,
  setCustomText,
  setDividerStyle,
  setLogoSize,
  setKotItemsPrices,
  setQrOptions,
  type EditableBlock,
  type EditableTemplate,
  type WriteProblem,
} from "@/lib/print-design-editor";
import type { EditorKind } from "@/lib/print-design-kinds";
import {
  ALIGN_LABEL,
  AUTO_CHOICE,
  AUTO_LABEL,
  BOLD_LABEL,
  BOLD_OFF_CHOICE,
  BOLD_ON_CHOICE,
  DIVIDER_LABEL,
  SIZE_LABEL,
} from "@/lib/print-design-labels";
import { Field } from "@/components/settings/SettingsFields";
import { capitalizePrintOption } from "@/components/settings/print-form-utils";
import { ChoiceChips } from "@/components/settings/print-design/ChoiceChips";
import { KotItemsFields } from "@/components/settings/print-design/KotItemsFields";
import { QrOptionsFields } from "@/components/settings/print-design/QrOptionsFields";
import type { Settings } from "@/types";

type Auto = typeof AUTO_CHOICE;
type BoldChoice = Auto | typeof BOLD_ON_CHOICE | typeof BOLD_OFF_CHOICE;

const ALIGN_CHOICES: readonly (Auto | BlockAlign)[] = [AUTO_CHOICE, ...BLOCK_ALIGNS];
const SIZE_CHOICES: readonly (Auto | BlockSize)[] = [AUTO_CHOICE, ...BLOCK_SIZES];
const BOLD_CHOICES: readonly BoldChoice[] = [AUTO_CHOICE, BOLD_ON_CHOICE, BOLD_OFF_CHOICE];
const DIVIDER_CHOICES: readonly (Auto | DividerStyle)[] = [AUTO_CHOICE, ...DIVIDER_STYLES];
// A line a rule keeps on the slip never goes below Small: it has to stay readable (01-PLAN §2.7).
const LOCKED_MIN_SIZE_BLOCKED: readonly BlockSize[] = ["xs"];
const CUSTOM_TEXT_ID = "print-design-custom-text";

interface BlockOptionsSheetProps<T extends EditableTemplate> {
  kind: EditorKind<T>;
  template: T;
  /** The line being edited; null keeps the sheet closed. */
  blockId: string | null;
  settings: Settings;
  /** Why the line is locked, in words; null when free. */
  lockText: string | null;
  issues: readonly WriteProblem[];
  onChange: (next: T) => void;
  onClose: () => void;
}

function boldChoiceOf(bold: boolean | undefined): BoldChoice {
  if (bold === undefined) return AUTO_CHOICE;
  return bold ? BOLD_ON_CHOICE : BOLD_OFF_CHOICE;
}

// The block's own options are typed `unknown` in the editor's generic model; each branch below reads only the
// shape its type is saved with (shared print-template.ts).
function StyleFields({ block, locked, lockText, onStyle }: {
  block: EditableBlock;
  locked: boolean;
  lockText: string | null;
  onStyle: (patch: { align?: BlockAlign | null; size?: BlockSize | null; bold?: boolean | null }) => void;
}) {
  return (
    <div className="space-y-4">
      <ChoiceChips
        legend="Alignment"
        options={ALIGN_CHOICES}
        value={block.align ?? AUTO_CHOICE}
        onChange={(v) => onStyle({ align: v === AUTO_CHOICE ? null : v })}
        labelOf={(v) => (v === AUTO_CHOICE ? AUTO_LABEL : ALIGN_LABEL[v])}
      />
      <ChoiceChips
        legend="Size"
        options={SIZE_CHOICES}
        value={block.size ?? AUTO_CHOICE}
        onChange={(v) => onStyle({ size: v === AUTO_CHOICE ? null : v })}
        labelOf={(v) => (v === AUTO_CHOICE ? AUTO_LABEL : SIZE_LABEL[v])}
        disabledOptions={locked ? LOCKED_MIN_SIZE_BLOCKED : []}
        hint={locked && lockText ? `${lockText}, so it can't be made extra small.` : undefined}
      />
      <ChoiceChips
        legend="Weight"
        options={BOLD_CHOICES}
        value={boldChoiceOf(block.bold)}
        onChange={(v) => onStyle({ bold: v === AUTO_CHOICE ? null : v === BOLD_ON_CHOICE })}
        labelOf={(v) => BOLD_LABEL[v]}
      />
    </div>
  );
}

// A Sheet edits one line: how it is aligned, sized and weighted, plus whatever its type carries (the logo's size,
// the divider's style, your own text, the QR code). Every change goes straight into the unsaved draft.
export function BlockOptionsSheet<T extends EditableTemplate>({
  kind,
  template,
  blockId,
  settings,
  lockText,
  issues,
  onChange,
  onClose,
}: BlockOptionsSheetProps<T>) {
  const block: EditableBlock | null = template.blocks.find((b) => b.id === blockId) ?? null;
  if (block === null) return null;
  const label = kind.blockLabel(block.type);
  const locked = lockText !== null;
  const problem = issues.find((issue) => issue.blockId === block.id)?.message ?? null;
  const options = block.options;

  return (
    <Sheet open onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full space-y-6 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{label}</SheetTitle>
          <SheetDescription>Changes show in the preview straight away and are saved with Save changes.</SheetDescription>
        </SheetHeader>

        {block.type === "logo" && (
          <ChoiceChips
            legend="Logo size"
            options={PRINT_LOGO_SIZES}
            value={(options as { logoSize: PrintLogoSize }).logoSize}
            onChange={(v) => onChange(setLogoSize(template, block.id, v))}
            labelOf={capitalizePrintOption}
          />
        )}
        {block.type === "divider" && (
          <ChoiceChips
            legend="Style"
            options={DIVIDER_CHOICES}
            value={(options as { style: DividerStyle } | undefined)?.style ?? AUTO_CHOICE}
            onChange={(v) => onChange(setDividerStyle(template, block.id, v === AUTO_CHOICE ? null : v))}
            labelOf={(v) => (v === AUTO_CHOICE ? AUTO_LABEL : DIVIDER_LABEL[v])}
          />
        )}
        {block.type === "customText" && (
          <Field label="Text" htmlFor={CUSTOM_TEXT_ID} error={problem ?? undefined} hint="Printed as you type it here.">
            <Textarea
              id={CUSTOM_TEXT_ID}
              rows={3}
              maxLength={PRINT_CUSTOM_TEXT_MAX}
              value={(options as { text: string }).text}
              onChange={(e) => onChange(setCustomText(template, block.id, e.target.value))}
            />
          </Field>
        )}
        {kind.spec.kind === "kot" && block.type === "items" && (
          <KotItemsFields
            prices={(options as { prices: boolean }).prices}
            onPrices={(prices) => onChange(setKotItemsPrices(template, block.id, prices))}
          />
        )}
        {block.type === "qr" && (
          <QrOptionsFields
            options={options as QrOptions}
            allowUpi={kind.allowUpiQr}
            upiId={settings.upiId}
            problem={problem}
            onChange={(next) => onChange(setQrOptions(template, block.id, next))}
          />
        )}
        {problem && block.type !== "customText" && block.type !== "qr" && (
          <p className="text-sm text-destructive">{problem}</p>
        )}

        <StyleFields
          block={block}
          locked={locked}
          lockText={lockText}
          onStyle={(patch) => onChange(setBlockStyle(template, block.id, patch))}
        />

        <SheetFooter className="gap-2 sm:justify-between sm:space-x-0">
          {isRepeatableBlockType(block.type) && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 text-destructive"
              onClick={() => {
                onChange(removeBlock(template, block.id));
                onClose();
              }}
            >
              <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
              Remove this line
            </Button>
          )}
          <Button type="button" className="min-h-11" onClick={onClose}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
