"use client";

import { useState } from "react";
import Link from "next/link";
import { LayoutGrid, Plus, QrCode } from "lucide-react";

import { useTables, useDeleteTable } from "@/hooks/use-tables";
import { useSettings } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { AdminGuard } from "@/components/shared/AdminGuard";
import { MenuPageShell } from "@/components/menu/MenuPageShell";
import { TableFormSheet } from "@/components/tables/TableFormSheet";
import { TableSetupList } from "@/components/tables/TableSetupList";
import { TABLES_QR_PATH } from "@/lib/table-sections";
import { longStayMinutesOf } from "@/lib/table-status";
import { settingsSectionPath } from "@/lib/settings-sections";
import type { Table } from "@/types";

// Placeholder rows shown while the floor plan loads. A cafe's real table count
// is dynamic (CR1.1), so this is purely a loading shape, not an expected size.
const SKELETON_ROWS = 6;

// The Settings anchor of the "Tables screen" card that owns the long-stay value.
const LONG_STAY_SETTINGS_HREF = `${settingsSectionPath("business")}#tables-screen`;

export default function TablesSetupPage() {
  return (
    <AdminGuard>
      <MenuPageShell>
        <TablesSetupContent />
      </MenuPageShell>
    </AdminGuard>
  );
}

function TablesSetupContent() {
  const tables = useTables();
  const settings = useSettings();
  const deleteTable = useDeleteTable();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const [deleting, setDeleting] = useState<Table | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (table: Table) => {
    setEditing(table);
    setFormOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    try {
      await deleteTable.mutateAsync(deleting.tableNo);
      setDeleting(null);
    } catch {
      // hook toasts on error (e.g. blocked while the table is occupied/reserved)
    }
  };

  const list = tables.data ?? [];
  // The dialog's copy keeps the last table while it fades out (deleting is
  // cleared the moment it closes, which would otherwise flash a blank name).
  const [shownDelete, setShownDelete] = useState<Table | null>(null);
  if (deleting && deleting !== shownDelete) setShownDelete(deleting);

  // Full ErrorState only when there is nothing on screen to keep showing.
  if (tables.isError && tables.data === undefined) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow="Tables" title="Setup" />
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
      <PageHeader
        eyebrow="Tables"
        title="Setup"
        description={
          tables.data === undefined
            ? "Loading tables…"
            : `${list.length} table${list.length === 1 ? "" : "s"} · drag to arrange — the same order shows on the floor and in the New Order table picker`
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild>
              <Link prefetch={false} href={TABLES_QR_PATH}>
                <QrCode className="mr-2 h-4 w-4" /> Print QR codes
              </Link>
            </Button>
            <Button onClick={openAdd}>
              <Plus className="mr-2 h-4 w-4" /> Add table
            </Button>
          </div>
        }
      />

      {/* Read-only here: the value is saved by Settings → Business details, the
          one section that owns the field. Hidden until Settings has loaded so a
          default never shows in place of the cafe's own number. */}
      {settings.data !== undefined && (
        <p className="text-sm text-muted-foreground">
          Long stay alert after {longStayMinutesOf(settings.data)} min ·{" "}
          <Link href={LONG_STAY_SETTINGS_HREF} className="underline">
            Change
          </Link>
        </p>
      )}

      {/* No data yet — loading, or a paused (offline) first read — is never
          "No tables yet": that empty state offers Add table on a real empty plan only. */}
      {tables.data === undefined ? (
        <div className="space-y-2 rounded-lg border p-4">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid className="h-8 w-8" />}
          title="No tables yet"
          description="Add your first table to start using the floor."
          action={
            <Button onClick={openAdd} className="mt-2">
              <Plus className="mr-2 h-4 w-4" /> Add table
            </Button>
          }
        />
      ) : (
        <>
          <TableSetupList tables={list} onEdit={openEdit} onDelete={setDeleting} />
          <p className="text-sm text-muted-foreground">
            Drag the handle, or use the up and down arrows. Changes save at once.
          </p>
        </>
      )}

      <TableFormSheet open={formOpen} onOpenChange={setFormOpen} table={editing} />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove table?"
        description={`"${shownDelete?.tableNo ?? ""}" will be removed from the floor plan. Past orders keep this table's name and are not affected — free the table first if it's occupied or reserved.`}
        confirmLabel="Remove"
        isLoading={deleteTable.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
