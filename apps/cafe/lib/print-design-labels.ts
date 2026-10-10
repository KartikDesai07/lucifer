import type {
  BillBlockType,
  BillDesign,
  BlockAlign,
  BlockSize,
  DividerStyle,
  KotBlockType,
  KotDesign,
  PrintFontKey,
  TokenBlockType,
  TokenDesign,
} from "@pos/shared/print-template";
import type { LockReason } from "@/lib/print-design-editor-ops";

// The words the Bill design editor shows (print customization S4). Plain English only: no field name, path or
// code ever reaches the screen. Pure data, so it is the one place to reword the editor.

export const BILL_BLOCK_LABEL: Record<BillBlockType, string> = {
  logo: "Logo",
  name: "Restaurant name",
  tagline: "Tagline",
  address: "Address",
  phone: "Contact number",
  gstin: "GST number",
  fssai: "FSSAI number",
  headerText: "Header note",
  title: "Bill title",
  cancelBanner: "Cancelled notice",
  billNo: "Bill number",
  token: "Token number",
  orderId: "Order ID",
  dateTime: "Date and time",
  table: "Table",
  customer: "Customer name",
  cashier: "Staff name",
  cancelReason: "Cancel reason",
  items: "Items",
  subtotal: "Sub-total",
  discount: "Discount",
  taxes: "GST amount",
  charges: "Table charge",
  total: "Total amount",
  taxIncluded: "GST included note",
  payment: "Payment",
  due: "Amount due",
  loyalty: "Reward points",
  footerText: "Footer message",
  printedAt: "Printed time",
  qr: "QR code",
  divider: "Divider",
  customText: "Your own text",
};

// Why a line cannot be switched off (the lock the shared contract carries, shared print-template.ts).
export const LOCK_REASON_TEXT: Record<LockReason, string> = {
  // Every kind with an "always" line (the bill, the token slip) shares this one sentence.
  always: "Always printed",
  gst: "Required on a GST bill",
  fssai: "Required while an FSSAI number is set",
  banner: "Required on this slip",
};

// The bill number has no switch of its own: "Show bill number" under Bill number is the one control.
export const BILL_NO_ROW_TEXT = "Turned on and off under Bill number.";

export const DESIGN_LABEL: Record<BillDesign, string> = {
  classic: "Classic",
  modern: "Modern",
  express: "Express",
  cafe: "Cafe",
};

export const CLASSIC_CURRENT_LABEL = "Classic — today's bill";

export const DESIGN_BLURB: Record<BillDesign, string> = {
  classic: "The bill you print today",
  modern: "Clean and airy",
  express: "Tight and compact",
  cafe: "Warm, with ornaments",
};

export const FONT_LABEL: Record<PrintFontKey, string> = {
  geistMono: "Classic",
  mono: "Typewriter",
  sans: "Clean",
  condensed: "Narrow",
  slab: "Slab",
};

// Shown in each font's own face, so the choice is visible before it is made.
export const FONT_SAMPLE_TEXT = "Masala chai ₹40";

export const AUTO_CHOICE = "auto";
export const AUTO_LABEL = "Automatic";

export const DIVIDER_LABEL: Record<DividerStyle, string> = {
  dashed: "Dashed",
  solid: "Solid",
  double: "Double",
  blank: "Blank space",
  ornament: "Ornament",
};

export const SIZE_LABEL: Record<BlockSize, string> = {
  xs: "Extra small",
  sm: "Small",
  md: "Medium",
  lg: "Large",
  xl: "Extra large",
};

export const ALIGN_LABEL: Record<BlockAlign, string> = {
  left: "Left",
  center: "Centre",
  right: "Right",
};

export const BOLD_ON_CHOICE = "bold";
export const BOLD_OFF_CHOICE = "plain";
export const BOLD_LABEL: Record<string, string> = {
  [AUTO_CHOICE]: AUTO_LABEL,
  [BOLD_ON_CHOICE]: "Bold",
  [BOLD_OFF_CHOICE]: "Not bold",
};

export const GENERIC_PROBLEM_TEXT = "This line has a setting that can't be saved. Reset it or remove it.";
export const GENERIC_DESIGN_PROBLEM_TEXT = "This design can't be saved yet. Reset it to start again.";

export const PREVIEW_LOAD_FAILED_TEXT = "Couldn't load the design preview. Check the connection.";

const NOTICE_TAIL = "Your printed bill does not change until you save.";

function joinPlain(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

// "GST number and Address are required on a GST bill, so they are turned on in your design. ..." — one sentence per
// reason, naming only the lines this design just had to switch on.
export function turnedOnNotice(labels: readonly string[], reason: LockReason): string {
  const many = labels.length > 1;
  const who = joinPlain(labels);
  const verb = many ? "are" : "is";
  const pronoun = many ? "they are" : "it is";
  switch (reason) {
    case "gst":
      return `${who} ${verb} required on a GST bill, so ${pronoun} turned on in your design. ${NOTICE_TAIL}`;
    case "fssai":
      return `${who} ${verb} required while an FSSAI number is set, so ${pronoun} turned on in your design. ${NOTICE_TAIL}`;
    case "banner":
    case "always":
      return `${who} ${verb} required on every slip, so ${pronoun} turned on in your design. ${NOTICE_TAIL}`;
  }
}

// ── The kitchen ticket (print customization S5) ──────────────────────────────

export const KOT_BLOCK_LABEL: Record<KotBlockType, string> = {
  logo: "Logo",
  name: "Restaurant name",
  title: "Ticket heading",
  station: "Kitchen station",
  kotNo: "Ticket number",
  token: "Token number",
  roundLabel: "Round",
  orderId: "Order ID",
  table: "Table",
  time: "Time",
  staff: "Staff name",
  voidReason: "Cancel reason",
  items: "Items",
  notes: "Order note",
  itemCount: "Item count",
  roundTotal: "Ticket total",
  qr: "QR code",
  divider: "Divider",
  customText: "Your own text",
};

// The ticket number has no switch of its own: "Show ticket number" under Ticket number is the one control.
export const KOT_NO_ROW_TEXT = "Turned on and off under Ticket number.";

// A cancelled-item or table-moved ticket always prints these lines, whatever their switch says (shared KOT_LOCKS).
// Items is locked on both too, but a table-moved ticket lists no dishes at all, so its note names only the one
// ticket where dishes do print (review s79 MIN-1).
export const KOT_BANNER_NOTE = "Always printed on a cancelled-item or table-moved ticket.";
export const KOT_VOID_ITEMS_NOTE = "Always printed on a cancelled-item ticket.";
export const KOT_PRICES_NEEDED_NOTE = "Prints only when Items show prices.";

// The token row (bill and kitchen ticket) keeps its own switch; this says why a slip may still show none.
export const TOKEN_ROW_NOTE = "Prints only on orders that have a token. Turn tokens on in Tokens & numbering.";

// The kitchen station row: the line ("BAR", "ALL STATIONS") exists only on a ticket split by station in printers mode.
export const STATION_ROW_NOTE = "Prints only when tickets are split by kitchen station, e.g. BAR. Set up stations in Printer setup.";

export const KOT_DESIGN_LABEL: Record<KotDesign, string> = {
  classic: "Classic",
  kitchenBold: "Kitchen Bold",
};

export const CLASSIC_KOT_CURRENT_LABEL = "Classic — today's ticket";

export const KOT_DESIGN_BLURB: Record<KotDesign, string> = {
  classic: "The ticket you print today",
  kitchenBold: "Big, bold dishes",
};

// The one Items option the kitchen ticket offers: dish options and dish notes always print.
export const KOT_ITEMS_PRICES_LABEL = "Show prices";
export const KOT_ITEMS_PRICES_DESCRIPTION = "Prints the amount beside each dish. Options and notes on a dish always print.";

// Which sample the preview shows (the three tickets a kitchen can get).
export type KitchenPreviewChip = "kot" | "void" | "moved";
export const KITCHEN_PREVIEW_CHIPS: readonly KitchenPreviewChip[] = ["kot", "void", "moved"];
export const KITCHEN_CHIP_LABEL: Record<KitchenPreviewChip, string> = {
  kot: "New order",
  void: "Cancelled item",
  moved: "Table moved",
};
export const KITCHEN_CHIP_LEGEND = "The kitchen gets three kinds of ticket. Pick one to see how it prints.";

// ── The token slip (print customization S7) ──────────────────────────────────

export const TOKEN_BLOCK_LABEL: Record<TokenBlockType, string> = {
  name: "Restaurant name",
  logo: "Logo",
  tokenNo: "Token number",
  label: "Token heading",
  dateTime: "Date and time",
  items: "Items",
  message: "Collect message",
  qr: "QR code",
  divider: "Divider",
  customText: "Your own text",
};

export const TOKEN_DESIGN_LABEL: Record<TokenDesign, string> = {
  bigNumber: "Big number",
  numberItems: "Number and items",
};

export const TOKEN_DESIGN_BLURB: Record<TokenDesign, string> = {
  bigNumber: "The number, as large as it gets",
  numberItems: "The number and what was ordered",
};

// No design saved = the standard token slip, which is Big number.
export const TOKEN_STANDARD_CURRENT_LABEL = "Big number — standard";

/** Under the design editor while tokens are off: the slip can be set up first, and nothing is switched on for the owner. */
export const TOKENS_OFF_HINT = "Turn on tokens above to print this slip.";
