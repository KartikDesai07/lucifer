"use client";

import { useEffect, useState } from "react";
// Named-only import: @types/qrcode declares no default export (pure ESM-style
// `export function`, no `export =`), so `import QRCode from "qrcode"` fails
// tsc regardless of esModuleInterop — this form works unconditionally.
import * as QRCode from "qrcode";
import { publicMenuPath } from "@pos/shared/public";
import { useMintTableToken } from "@/hooks/use-tables";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { Table } from "@/types";

interface QrSheetProps {
  tables: Table[];
}

// Big enough to scan comfortably from a standing height at a table tent;
// small enough that a 3-column A4 grid still fits several rows per sheet.
const QR_PIXELS = 200;

// A4 poster sheet, NOT the 80mm thermal slip lib/print.ts sizes for — that
// module's widths/fonts are a different physical medium and don't apply here.
// Scoped in this file (rather than lib/print.ts) because this component owns
// the only page that needs it. Each cell is kept whole across a page break so
// a QR is never sliced between two printed sheets. Exported for the QR page to
// pass as react-to-print's pageStyle — injected into the ISOLATED print
// iframe, never a <style> in the dashboard document (whole-document printing
// put the admin sidebar/header on the sheet; review fix).
export const QR_PRINT_STYLE = `
  @page { size: A4 portrait; margin: 10mm; }
  @media print { body { margin: 0; } }
  .qr-cell { break-inside: avoid; page-break-inside: avoid; }
`;

// Printable per-table QR grid for the public menu (CR2.1). Renders each
// table's public URL as an SVG via the `qrcode` package.
//
// `qrcode`'s package.json declares a `browser` field that swaps its main
// entry (./lib/index.js -> ./lib/server.js, which shells out to the native
// `canvas` module and touches `fs`) for ./lib/browser.js when bundled for a
// browser target — which is what Next.js's client webpack build does for any
// "use client" module by default. Verified by reading browser.js: it only
// requires ./core/qrcode + the canvas/svg renderers, no Node built-ins.
// `toString(url, { type: "svg" })` is that browser build's SVG path — a plain
// string, so it's rendered here as a data: URI in a plain <img>, never via
// dangerouslySetInnerHTML.
export function QrSheet({ tables }: QrSheetProps) {
  const [origin, setOrigin] = useState<string | null>(null);
  // token -> "data:image/svg+xml;..." — only ever built for tables that HAVE
  // a token; a table with none gets no entry and renders the placeholder.
  const [images, setImages] = useState<Record<string, string>>({});
  // The mint/regenerate seam (review fix: the hook previously had NO caller,
  // so a table that predates CR2 could never get a QR at all). The rendering
  // page (tables/qr) is the admin gate — staff never reach this component.
  // One hook instance serves every cell: `isPending` therefore disables ALL
  // the buttons while one mint runs, which doubles as the double-tap guard.
  const mint = useMintTableToken();
  const [regenerating, setRegenerating] = useState<Table | null>(null);

  const confirmRegenerate = async () => {
    if (!regenerating) return;
    try {
      await mint.mutateAsync(regenerating.tableNo);
      setRegenerating(null);
    } catch {
      // hook toasts on error; keep the dialog open so the admin can retry
    }
  };

  // The deployment's own origin, read in the browser — never an env var: an
  // env value can drift from what a given deploy is actually served on
  // (preview vs. prod), and this must match exactly what the diner's phone
  // will hit.
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    const tokens = tables
      .map((t) => t.publicToken)
      .filter((t): t is string => !!t);

    Promise.all(
      tokens.map(async (token) => {
        const url = `${origin}${publicMenuPath(token)}`;
        const svg = await QRCode.toString(url, {
          type: "svg",
          width: QR_PIXELS,
          margin: 1,
        });
        return [token, `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`] as const;
      }),
    ).then((entries) => {
      if (!cancelled) setImages(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [origin, tables]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {tables.map((table) => {
          const token = table.publicToken;
          const url = token && origin ? `${origin}${publicMenuPath(token)}` : null;
          const image = token ? images[token] : undefined;
          return (
            <div
              key={table._id}
              className="qr-cell flex flex-col items-center gap-2 rounded-lg border p-4 text-center"
            >
              {!token ? (
                // No token minted yet — nothing scannable, never a QR pointing
                // at a broken/guessed URL.
                <div
                  style={{ width: QR_PIXELS, height: QR_PIXELS }}
                  className="flex items-center justify-center rounded bg-muted p-2 text-xs text-muted-foreground"
                >
                  No QR yet — mint a token for this table first
                </div>
              ) : image ? (
                // A data: URI, not a remote/optimizable image — next/image
                // adds nothing here and this print sheet has no host to
                // configure.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt={`QR code for ${table.tableNo}`}
                  width={QR_PIXELS}
                  height={QR_PIXELS}
                />
              ) : (
                <div
                  style={{ width: QR_PIXELS, height: QR_PIXELS }}
                  className="animate-pulse rounded bg-muted"
                  aria-hidden
                />
              )}
              <p className="text-lg font-semibold">{table.tableNo}</p>
              {url && (
                <p className="break-all text-xs text-muted-foreground">{url}</p>
              )}
              {/* Admin actions. print:hidden is belt-and-braces — printing
                  goes through react-to-print's iframe, which copies only this
                  subtree, so the class is what keeps them off the paper if
                  anyone ever prints the page directly again. */}
              {!token ? (
                <Button
                  size="sm"
                  className="print:hidden"
                  disabled={mint.isPending}
                  onClick={() => mint.mutate(table.tableNo)}
                >
                  Generate QR
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="print:hidden text-muted-foreground"
                  disabled={mint.isPending}
                  onClick={() => setRegenerating(table)}
                >
                  Regenerate
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={!!regenerating}
        onOpenChange={(o) => !o && setRegenerating(null)}
        title="Regenerate this QR?"
        description={`A new code is minted for "${regenerating?.tableNo}" and any sticker already printed for it stops working immediately. Print and replace that table's sticker after regenerating.`}
        confirmLabel="Regenerate"
        isLoading={mint.isPending}
        onConfirm={confirmRegenerate}
      />
    </div>
  );
}
