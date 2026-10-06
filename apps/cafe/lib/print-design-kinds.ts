import type { BillTemplate, KotTemplate, TokenTemplate } from "@pos/shared/print-template";
import { BILL_EDITOR, KOT_EDITOR, TOKEN_EDITOR, type EditableBlock, type EditableTemplate, type SlipKindSpec } from "@/lib/print-design-editor";
import {
  BILL_BLOCK_LABEL,
  BILL_NO_ROW_TEXT,
  CLASSIC_CURRENT_LABEL,
  CLASSIC_KOT_CURRENT_LABEL,
  DESIGN_BLURB,
  DESIGN_LABEL,
  KOT_BANNER_NOTE,
  KOT_VOID_ITEMS_NOTE,
  KOT_BLOCK_LABEL,
  KOT_DESIGN_BLURB,
  KOT_DESIGN_LABEL,
  KOT_NO_ROW_TEXT,
  KOT_PRICES_NEEDED_NOTE,
  TOKEN_BLOCK_LABEL,
  TOKEN_DESIGN_BLURB,
  TOKEN_DESIGN_LABEL,
  TOKEN_ROW_NOTE,
  TOKEN_STANDARD_CURRENT_LABEL,
} from "@/lib/print-design-labels";
import { TOKEN_DEFAULT_DESIGN } from "@/lib/print-template-designs";
import type { Settings, UpdateSettingsInput } from "@/types";

// One config per slip kind (print customization S5, 05-S5-plan D3; the token slip, S7): everything the design editor's hook and page
// pieces would otherwise hard-code for the bill. BILL_KIND reproduces S4's copy and behaviour word for word;
// KOT_KIND is the kitchen ticket. Pure data and pure functions: no React, no fetch.

/** The page-visible words that differ between the bill and the kitchen ticket. */
export interface EditorCopy {
  sectionTitle: string;
  sectionDescription: string;
  /** The gallery's accessible group name. */
  galleryLabel: string;
  /** The gallery card for the slip printed today (Classic, while no template is saved). */
  todayCardLabel: string;
  unreadable: string;
  recoverClassicLabel: string;
  keepTodayLabel: string;
  customizeLabel: string;
  customizeHint: string;
  backToTodayLabel: string;
  backToTodayConfirm: { title: string; description: string; confirmLabel: string };
  linesTitle: string;
  linesDescription: string;
}

export interface EditorKind<T extends EditableTemplate> {
  spec: SlipKindSpec<T>;
  /** A line's name, from its type. */
  blockLabel(type: string): string;
  designLabel: Record<T["design"], string>;
  designBlurb: Record<T["design"], string>;
  /** The design printed while no template is saved: Classic for the bill and the ticket, Big number for the token slip. */
  todayDesign: T["design"];
  /** What the ticket/bill number row says instead of a switch. */
  forcedRowText: string;
  /** A short hint under a row (never a lock, never a flip); null when there is none. */
  noteOf(block: EditableBlock, template: T): string | null;
  /** A pay QR is offered (the bill); the kitchen ticket's QR is a link only. */
  allowUpiQr: boolean;
  copy: EditorCopy;
  /** The settings the preview and the font preload read: `settings` with this kind's template key set to the draft. */
  withDraft(settings: Settings, draft: T | null): Settings;
  /** What the draft adds to the page's one PUT body. */
  bodyOf(draft: T | null): UpdateSettingsInput;
}

const SHARED_LINES_DESCRIPTION = "Switch a line off, drag it, or use the arrows to move it.";
const SHARED_HINT = "Move, hide and style every line. Today's settings below stay as they are until you customize.";

export const BILL_KIND: EditorKind<BillTemplate> = {
  spec: BILL_EDITOR,
  blockLabel: (type) => BILL_BLOCK_LABEL[type as keyof typeof BILL_BLOCK_LABEL],
  designLabel: DESIGN_LABEL,
  designBlurb: DESIGN_BLURB,
  todayDesign: "classic",
  forcedRowText: BILL_NO_ROW_TEXT,
  noteOf: (block) => (block.type === "token" ? TOKEN_ROW_NOTE : null),
  allowUpiQr: true,
  copy: {
    sectionTitle: "Bill design",
    sectionDescription: "Pick a look for the bill. Nothing changes on printed bills until you press Save.",
    galleryLabel: "Bill design",
    todayCardLabel: CLASSIC_CURRENT_LABEL,
    unreadable: "Your saved bill design could not be read, so today's bill is printing instead.",
    recoverClassicLabel: "Start Classic from today's settings",
    keepTodayLabel: "Keep today's bill",
    customizeLabel: "Customize this bill",
    customizeHint: SHARED_HINT,
    backToTodayLabel: "Back to today's bill",
    backToTodayConfirm: {
      title: "Go back to today's bill?",
      description:
        "The design is removed when you press Save, and today's bill comes back exactly as your settings print it now.",
      confirmLabel: "Back to today's bill",
    },
    linesTitle: "Lines on the bill",
    linesDescription: SHARED_LINES_DESCRIPTION,
  },
  withDraft: (settings, draft) => ({ ...settings, billTemplate: draft }),
  bodyOf: (draft) => ({ billTemplate: draft }),
};

// Whether the items line shows prices (the total line prints only then). Anything unreadable counts as "off".
function itemsShowPrices(template: KotTemplate): boolean {
  const options = template.blocks.find((block) => block.type === "items")?.options;
  return typeof options === "object" && options !== null && "prices" in options && options.prices === true;
}

export const KOT_KIND: EditorKind<KotTemplate> = {
  spec: KOT_EDITOR,
  blockLabel: (type) => KOT_BLOCK_LABEL[type as keyof typeof KOT_BLOCK_LABEL],
  designLabel: KOT_DESIGN_LABEL,
  designBlurb: KOT_DESIGN_BLURB,
  todayDesign: "classic",
  forcedRowText: KOT_NO_ROW_TEXT,
  noteOf: (block, template) => {
    if (block.type === "token") return TOKEN_ROW_NOTE;
    // A cancelled-item or table-moved ticket always prints these three (shared KOT_LOCKS.withBanner); their
    // switches stay free because a normal ticket is the client's choice.
    if (KOT_EDITOR.locks.withBanner.includes(block.type)) {
      // A table-moved ticket lists no dishes (the renderers' rule), so the Items note names only the cancelled one.
      return block.type === "items" ? KOT_VOID_ITEMS_NOTE : KOT_BANNER_NOTE;
    }
    if (block.type === "roundTotal" && !itemsShowPrices(template)) return KOT_PRICES_NEEDED_NOTE;
    return null;
  },
  allowUpiQr: false,
  copy: {
    sectionTitle: "Kitchen ticket design",
    sectionDescription: "Pick a look for the kitchen ticket. Nothing changes on printed tickets until you press Save.",
    galleryLabel: "Kitchen ticket design",
    todayCardLabel: CLASSIC_KOT_CURRENT_LABEL,
    unreadable: "Your saved ticket design could not be read, so today's ticket is printing instead.",
    recoverClassicLabel: "Start Classic from today's settings",
    keepTodayLabel: "Keep today's ticket",
    customizeLabel: "Customize this ticket",
    customizeHint: SHARED_HINT,
    backToTodayLabel: "Back to today's ticket",
    backToTodayConfirm: {
      title: "Go back to today's ticket?",
      description:
        "The design is removed when you press Save, and today's ticket comes back exactly as your settings print it now.",
      confirmLabel: "Back to today's ticket",
    },
    linesTitle: "Lines on the ticket",
    linesDescription: SHARED_LINES_DESCRIPTION,
  },
  withDraft: (settings, draft) => ({ ...settings, kotTemplate: draft }),
  bodyOf: (draft) => ({ kotTemplate: draft }),
};

// The token slip (S7). No template saved = the standard slip, Big number (owner decision), so "back to standard" removes
// the saved design. No line has a switch another control owns, and a QR is a link only.
const TOKEN_HINT = "Move, hide and style every line of the token slip.";

export const TOKEN_KIND: EditorKind<TokenTemplate> = {
  spec: TOKEN_EDITOR,
  blockLabel: (type) => TOKEN_BLOCK_LABEL[type as keyof typeof TOKEN_BLOCK_LABEL],
  designLabel: TOKEN_DESIGN_LABEL,
  designBlurb: TOKEN_DESIGN_BLURB,
  todayDesign: TOKEN_DEFAULT_DESIGN,
  // No token line is forced on by another control, so this is never shown.
  forcedRowText: "",
  noteOf: () => null,
  allowUpiQr: false,
  copy: {
    sectionTitle: "Token slip design",
    sectionDescription:
      "Pick a look for the slip your customer gets with their token number. Nothing changes on printed slips until you press Save.",
    galleryLabel: "Token slip design",
    todayCardLabel: TOKEN_STANDARD_CURRENT_LABEL,
    unreadable: "Your saved token design could not be read, so the standard token slip is printing instead.",
    recoverClassicLabel: "Start Big number again",
    keepTodayLabel: "Keep the standard slip",
    customizeLabel: "Customize this slip",
    customizeHint: TOKEN_HINT,
    backToTodayLabel: "Back to standard",
    backToTodayConfirm: {
      title: "Go back to the standard token slip?",
      description: "The design is removed when you press Save, and the standard Big number slip prints again.",
      confirmLabel: "Back to standard",
    },
    linesTitle: "Lines on the token slip",
    linesDescription: SHARED_LINES_DESCRIPTION,
  },
  withDraft: (settings, draft) => ({ ...settings, tokenTemplate: draft }),
  bodyOf: (draft) => ({ tokenTemplate: draft }),
};
