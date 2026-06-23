// Shared react-to-print page style for the 80mm thermal printer. Used by the
// POS receipt/KOT, the order-detail receipt, and the end-of-day summary so the
// page setup stays in one place.
export const RECEIPT_PAGE_STYLE =
  "@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }";
