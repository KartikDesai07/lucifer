// Printing redesign, Phase 1 Session 1C (spec §7.7): the one large inverted banner at the top of a slip
// that repeats paper — "REPRINT", "DUPLICATE", or several joined ("BACKUP PRINTER · REPRINT"). The
// labels live on the print job, never in the payload, so the snapshot a slip prints from is unchanged.
// Thermal printers are monochrome: white on black survives rasterizing, the desktop app prints
// backgrounds, and print-color-adjust keeps a browser's own print dialog from dropping the black.
const BANNER_STYLE = { WebkitPrintColorAdjust: "exact", printColorAdjust: "exact" } as const;

export function PrintBanner({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="mb-1.5 bg-black py-1 text-center text-[1.29em] font-bold tracking-widest text-white" style={BANNER_STYLE}>
      {text}
    </div>
  );
}
