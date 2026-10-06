import type { ReactNode } from "react";
import type { create } from "qrcode";

import { isSafeHttpsLink, payQrPlan, upiPayUri } from "@pos/shared/print-qr";
import type {
  BillBlockOf,
  CustomTextBlock,
  DividerOptions,
  DividerStyle,
  KotBlockOf,
  TokenBlockOf,
} from "@pos/shared/print-template";
import { inr } from "@/lib/utils";
import { loadedSlipCode } from "./slip-code";
import type { BillSlipContext, KotRenderContext } from "./slip-context";
import { validTillLabel } from "./slip-format";

// The lines every design shares (print customization S3, 01-PLAN A1.1 / A1.2): dividers, free text and QR codes.
// Each design hands in a small theme (rule margin, QR layout, caption and text classes) and gets renderers back, so
// a line a client ADDS to any design prints in that design's own look. 1-bit thermal rules: no opacity, no grey,
// no drop effects, borders >= 1px.

/** A QR module is 2 CSS px: >= 3.6 printer dots at 58 mm (384 dots / 210 px) and at 80 mm (576 / 300). */
export const QR_MODULE_PX = 2;
/** Blank modules around the code. A scanner needs a quiet zone; the slip's own white padding is not counted on. */
export const QR_QUIET_MODULES = 2;
const QR_ERROR_CORRECTION = "M";

export type QrLayout = "left" | "centreBeside" | "centreUnder";

export interface GenericTheme {
  /** Vertical margin of a rule, as a whole literal class ("my-1"). */
  ruleMargin: string;
  /** What a divider with no options prints in this design. */
  defaultStyle: DividerStyle;
  qrLayout: QrLayout;
  /** The QR caption's own look (size, weight, case). */
  captionClass: string;
  /** Custom text's own look. */
  textClass: string;
}

// ── Dividers ─────────────────────────────────────────────────────────────────

// "double" is a 3 px double border: two 1 px lines with a 1 px gap, so neither line is thinner than a printer dot.
const RULE_CLASS: Record<"dashed" | "solid" | "double", string> = {
  dashed: "border-t border-dashed border-black",
  solid: "border-t border-solid border-black",
  double: "border-t-[3px] border-double border-black",
};

// Dots and a diamond as SVG fills: several faces lack the diamond glyph, and a drawn shape prints in every lane.
function Ornament({ margin }: { margin: string }) {
  return (
    <div className={`${margin} flex justify-center`} aria-hidden="true">
      <svg viewBox="0 0 56 10" className="h-2.5 w-14" fill="black">
        <circle cx="6" cy="5" r="1.5" />
        <circle cx="17" cy="5" r="1.5" />
        <path d="M28 0 33 5 28 10 23 5Z" />
        <circle cx="39" cy="5" r="1.5" />
        <circle cx="50" cy="5" r="1.5" />
      </svg>
    </div>
  );
}

export function ruleNode(theme: Pick<GenericTheme, "ruleMargin">, style: DividerStyle): ReactNode {
  if (style === "blank") return <div className="h-3" />;
  if (style === "ornament") return <Ornament margin={theme.ruleMargin} />;
  return <div className={`${theme.ruleMargin} ${RULE_CLASS[style]}`} />;
}

export function genericDivider(theme: GenericTheme): (block: { options?: DividerOptions }) => ReactNode {
  return (block) => ruleNode(theme, block.options?.style ?? theme.defaultStyle);
}

// ── Custom text ──────────────────────────────────────────────────────────────

export function genericCustomText(theme: GenericTheme): (block: CustomTextBlock) => ReactNode {
  // Named: react/display-name flags an anonymous renderer that returns JSX.
  function customText(block: CustomTextBlock): ReactNode {
    const text = block.options.text.trim();
    return text === "" ? null : <div className={`whitespace-pre-wrap break-words ${theme.textClass}`}>{text}</div>;
  }
  return customText;
}

// ── QR ───────────────────────────────────────────────────────────────────────

// One <path> of the dark modules, run-length per row ("M x y h n v1 h-n z"), in module units: the viewBox scales it.
// null when the text does not fit a QR code (create throws): nothing prints rather than a broken code. The encoder
// is in the lazy slip chunk (R6, slip-code.ts): a receipt with a QR line renders only once it is loaded.
function qrSvg(text: string): ReactNode {
  const encode = loadedSlipCode()?.createQr;
  if (!encode) return null;
  let modules: ReturnType<typeof create>["modules"];
  try {
    modules = encode(text, { errorCorrectionLevel: QR_ERROR_CORRECTION }).modules;
  } catch {
    return null;
  }
  const span = modules.size + 2 * QR_QUIET_MODULES;
  const px = span * QR_MODULE_PX;
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col++;
      parts.push(`M${start + QR_QUIET_MODULES} ${row + QR_QUIET_MODULES}h${col - start}v1h-${col - start}z`);
    }
  }
  return (
    <svg
      width={px}
      height={px}
      viewBox={`0 0 ${span} ${span}`}
      shapeRendering="crispEdges"
      fill="black"
      className="shrink-0"
      role="img"
      aria-label="QR code"
    >
      <path d={parts.join("")} />
    </svg>
  );
}

const QR_ROW_CLASS: Record<QrLayout, string> = {
  left: "mt-2 flex items-center gap-2.5",
  centreBeside: "mt-2 flex items-center justify-center gap-2",
  centreUnder: "mt-2 flex flex-col items-center gap-1",
};
const QR_CAPTION_CLASS: Record<QrLayout, string> = {
  left: "min-w-0 flex-1 break-words",
  centreBeside: "min-w-0 break-words",
  centreUnder: "break-words text-center",
};

// The note ("Valid till ...") sits under the whole row, whatever the layout: left-aligned for "left", centred otherwise.
const QR_NOTE_CLASS: Record<QrLayout, string> = {
  left: "mt-1 break-words text-left text-black",
  centreBeside: "mt-1 break-words text-center text-black",
  centreUnder: "mt-1 break-words text-center text-black",
};

function qrNode(theme: GenericTheme, text: string, caption: string, note?: string): ReactNode {
  const svg = qrSvg(text);
  if (svg === null) return null;
  const row = (
    <div className={QR_ROW_CLASS[theme.qrLayout]}>
      {svg}
      {caption !== "" && <div className={`${QR_CAPTION_CLASS[theme.qrLayout]} ${theme.captionClass}`}>{caption}</div>}
    </div>
  );
  if (note === undefined) return row;
  return (
    <>
      {row}
      <div className={`${QR_NOTE_CLASS[theme.qrLayout]} ${theme.captionClass}`}>{note}</div>
    </>
  );
}

// The stored template was read with the lax READ schema, so a link is re-checked with the write gate's own rule: an
// unusable one prints nothing.
function linkQr(theme: GenericTheme, options: { url: string; caption?: string }): ReactNode {
  const url = options.url.trim();
  return isSafeHttpsLink(url) ? qrNode(theme, url, options.caption?.trim() ?? "") : null;
}

export function genericBillQr(theme: GenericTheme): (block: BillBlockOf<"qr">, ctx: BillSlipContext) => ReactNode {
  return (block, ctx) => {
    if (block.options.content === "link") return linkQr(theme, block.options);
    const { order, name } = ctx;
    // The owner's pay-QR rule (01-PLAN Amendment A4) is payQrPlan's alone: the mode, the amount (what is owed, or
    // the full total once paid) and the valid-till window counted from the bill's first print. null prints nothing.
    const plan = payQrPlan({
      mode: ctx.payQrMode,
      minutes: ctx.payQrMinutes,
      upiId: ctx.upiId ?? "",
      cancelled: ctx.isCancelled,
      total: order.total,
      paid: order.paidAmount,
      firstPrintedAt: order.billFirstPrintedAt,
      nowMs: ctx.nowMs,
    });
    if (plan === null) return null;
    const uri = upiPayUri({
      upiId: ctx.upiId ?? "",
      payee: name ?? "",
      amount: plan.amount,
      note: order.billNumber !== undefined ? `Bill ${order.billNumber}` : `Order ${order.orderId}`,
    });
    const caption = block.options.caption?.trim() ?? "";
    const note = plan.validTillMs === null ? undefined : validTillLabel(plan.validTillMs, ctx.nowMs);
    return qrNode(theme, uri, caption === "" ? `Scan to pay ${inr(plan.amount)}` : caption, note);
  };
}

export function genericKotQr(theme: GenericTheme): (block: KotBlockOf<"qr">, ctx: KotRenderContext) => ReactNode {
  return (block) => linkQr(theme, block.options);
}

// The token slip's QR (S7): a link only, like the kitchen ticket's. It needs no context, so a renderer map takes it as is.
export function genericTokenQr(theme: GenericTheme): (block: TokenBlockOf<"qr">) => ReactNode {
  return (block) => linkQr(theme, block.options);
}
