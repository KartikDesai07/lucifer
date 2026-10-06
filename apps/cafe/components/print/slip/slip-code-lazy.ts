import { create } from "qrcode";

import type { BillBlockType, BillDesign, KotBlockType, KotDesign } from "@pos/shared/print-template";
import { BILL_CAFE_DESIGN } from "./bill-cafe-blocks";
import { BILL_EXPRESS_DESIGN } from "./bill-express-blocks";
import { BILL_MODERN_DESIGN } from "./bill-modern-blocks";
import { KOT_BOLD_DESIGN } from "./kot-bold-blocks";
import type { BillRenderers, KotRenderers, SlipDesign } from "./slip-designs";

// R6 (01-PLAN A4): the lazy slip chunk, the code only a saved template needs: every non-Classic design and the QR
// encoder. slip-code.ts is its ONLY importer, through import(); a static import anywhere else puts it back into
// every receipt page's First Load. Classic's own renderers stay eager, so a cafe with no template never fetches this.

export interface SlipCode {
  bill: Record<Exclude<BillDesign, "classic">, SlipDesign<BillRenderers, BillBlockType>>;
  kot: Record<Exclude<KotDesign, "classic">, SlipDesign<KotRenderers, KotBlockType>>;
  createQr: typeof create;
}

export const SLIP_CODE: SlipCode = {
  bill: { modern: BILL_MODERN_DESIGN, express: BILL_EXPRESS_DESIGN, cafe: BILL_CAFE_DESIGN },
  kot: { kitchenBold: KOT_BOLD_DESIGN },
  createQr: create,
};
