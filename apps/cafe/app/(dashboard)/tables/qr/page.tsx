"use client";

import { useRef } from "react";
import Link from "next/link";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer } from "lucide-react";

import { useTables } from "@/hooks/use-tables";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { QrSheet, QR_PRINT_STYLE } from "@/components/tables/QrSheet";
import { TABLES_SETUP_PATH } from "@/lib/table-sections";

// Skeleton tiles shown while the floor plan loads — a plain loading shape,
// not an expected table count.
const SKELETON_TILES = 6;

// Admin-only print sheet: one QR sticker per table for the public menu
// (CR2.1). Three layers keep staff out: the edge fence (ADMIN_ROUTES), the
// AdminGuard below, and the server's own admin check on minting a token — a
// staff login has no business printing stickers that mint/regenerate a
// table's public identity.
export default function TableQrPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <TableQrContent />
      </MenuPageShell>
    </AdminGuard>
  );
}

function TableQrContent() {
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

  const hasTables = (tables.data?.length ?? 0) > 0;
  const header = (
    <PageHeader
      className="print:hidden"
      eyebrow="Tables"
      title="QR codes"
      description="One sticker per table for the public menu. Prints on A4 — cut along the grid."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link prefetch={false} href={TABLES_SETUP_PATH}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to setup
            </Link>
          </Button>
          <Button size="sm" onClick={() => printSheet()} disabled={!hasTables}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      }
    />
  );

  // Full ErrorState only when there is nothing on screen to keep showing.
  if (tables.isError && tables.data === undefined) {
    return (
      <div className="space-y-4">
        {header}
        <ErrorState
          title="Couldn't load the tables"
          description="Check the internet connection, then try again."
          onRetry={() => tables.refetch()}
          retryLabel="Try again"
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}

      {/* No data yet (loading, or a paused offline first read) is never "No tables yet". */}
      {tables.data === undefined ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {Array.from({ length: SKELETON_TILES }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
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
