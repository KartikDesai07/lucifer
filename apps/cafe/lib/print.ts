// Shared react-to-print page style for the 80mm thermal printer. Used by the
// POS receipt/KOT, the order-detail receipt, and the end-of-day summary so the
// page setup stays in one place.
export const RECEIPT_PAGE_STYLE =
  "@page { size: 80mm auto; margin: 4mm; } @media print { body { margin: 0; } }";

// ── Why two print jobs must NEVER fire in the same tick (CR1.2) ──────────────
// react-to-print (package.json pins ^3.0.5; the installed build is 3.3.0) keeps
// ONE iframe with the fixed id "printWindow": it invokes onAfterPrint and only
// THEN removes it, and every trigger force-removes any existing #printWindow
// first. So two triggers in one tick — or firing the receipt synchronously inside
// the KOT's onAfterPrint — makes the KOT's teardown delete the receipt's
// just-appended iframe, silently killing the receipt print. The POS therefore
// chains them: a guard ref keeps the KOT effect from re-firing (the trigger's
// identity changes every render), onAfterPrint only flips that flag, and the
// receipt goes out on the NEXT effect flush — safely after the library's teardown.
//
// Verified on desktop Chrome/Firefox ONLY. On MOBILE user-agents (a tablet POS —
// /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i) 3.3.0 fires
// onAfterPrint on a fixed 500ms timer after invoking print() rather than at job
// completion, so the two jobs can overlap there instead of being sequenced.
// Tablets/phones are therefore NOT a supported counter device (CR1.6 decision —
// docs/GO-LIVE-CHECKLIST.md §7); desktop Chrome/Firefox is the verified path.
