"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer } from "lucide-react";

import { useTables } from "@/hooks/use-tables";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { QrSheet, QR_PRINT_STYLE } from "@/components/tables/QrSheet";

// Skeleton tiles shown while the floor plan loads — a plain loading shape,
// not an expected table count (mirrors tables/page.tsx's SKELETON_TILES).
const SKELETON_TILES = 6;

// Admin-only print sheet: one QR sticker per table for the public menu
// (CR2.1). This route sits inside the (dashboard) group so Auth.js already
// bounces a signed-out visitor at the edge; the content is ALSO gated on
// `isAdmin` here — the same content-level gate tables/page.tsx uses for its
// own admin-only controls — because a staff login has no business printing
// stickers that mint/regenerate a table's public identity.
export default function TableQrPage() {
  const { isAdmin, isLoading: authLoading } = useAuth();
  const tables = useTables();

  // react-to-print's isolated iframe, NOT window.print() — a whole-document
  // print includes the (dashboard) layout's sidebar and header band on the
  // first sheet (adversarial-review finding), and iframe isolation is also
  // this repo's one sanctioned print path (lib/print.ts). Only one job ever
  // fires from this page, so the single-#printWindow chaining rule is moot.
  const sheetRef = useRef<HTMLDivElement>(null);
  const printSheet = useReactToPrint({
    contentRef: sheetRef,
    documentTitle: "table-qr-codes",
    pageStyle: QR_PRINT_STYLE,
  });

  if (authLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <EmptyState
        title="Admin only"
        description="Ask an admin to print QR codes for the floor plan."
      />
    );
  }

  const hasTables = (tables.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Table QR codes</h2>
          <p className="text-sm text-muted-foreground">
            One sticker per table for the public menu. Prints on A4 — cut
            along the grid.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/tables">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to tables
            </Link>
          </Button>
          <Button
            size="sm"
            onClick={() => printSheet()}
            disabled={!hasTables}
          >
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      {tables.isLoading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: SKELETON_TILES }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : tables.isError ? (
        <p className="text-sm text-destructive">
          Failed to load tables. Refresh to retry.
        </p>
      ) : !hasTables ? (
        <EmptyState
          title="No tables yet"
          description="Add a table first, then come back to print its QR code."
        />
      ) : (
        // The ref wraps ONLY the sheet: react-to-print copies this subtree
        // into its iframe, so no admin chrome can ever reach the paper.
        <div ref={sheetRef}>
          <QrSheet tables={tables.data ?? []} />
        </div>
      )}
    </div>
  );
}
