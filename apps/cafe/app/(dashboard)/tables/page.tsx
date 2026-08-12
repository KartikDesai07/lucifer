"use client";

import { useState } from "react";
import { LayoutGrid, Plus } from "lucide-react";

import { useTables, useUpdateTable, useDeleteTable } from "@/hooks/use-tables";
import { useAuth } from "@/hooks/use-auth";
import type { TableStatus } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TableCard } from "@/components/tables/TableCard";
import { TableFormSheet } from "@/components/tables/TableFormSheet";
import type { Table } from "@/types";

// Placeholder tiles shown while the floor plan loads. A cafe's real table count
// is dynamic (CR1.1), so this is purely a loading shape, not an expected size.
const SKELETON_TILES = 8;

export default function TablesPage() {
  const { isAdmin } = useAuth();
  const tables = useTables();
  const updateTable = useUpdateTable();
  const deleteTable = useDeleteTable();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const [deleting, setDeleting] = useState<Table | null>(null);

  const setStatus = (table: Table, status: TableStatus) =>
    updateTable.mutate({ tableNo: table.tableNo, data: { status } });

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

  const hasTables = (tables.data?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Tables</h2>
          <p className="text-sm text-muted-foreground">
            Live table status. Updates automatically every 30 seconds.
          </p>
        </div>
        {isAdmin && (
          <Button onClick={openAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add table
          </Button>
        )}
      </div>

      {tables.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: SKELETON_TILES }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : tables.isError ? (
        <p className="text-sm text-destructive">
          Failed to load tables. Refresh to retry.
        </p>
      ) : !hasTables ? (
        <EmptyState
          icon={<LayoutGrid className="h-8 w-8" />}
          title={isAdmin ? "No tables yet" : "Floor plan not set up"}
          description={
            isAdmin
              ? "Add your first table to start tracking occupancy."
              : "Ask an admin to set up the floor plan here."
          }
          action={
            isAdmin ? (
              <Button onClick={openAdd} className="mt-2">
                <Plus className="mr-2 h-4 w-4" /> Add table
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(tables.data ?? []).map((table) => (
            <TableCard
              key={table._id}
              table={table}
              isAdmin={isAdmin}
              statusPending={updateTable.isPending}
              onSetStatus={setStatus}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {isAdmin && (
        <>
          <TableFormSheet
            open={formOpen}
            onOpenChange={setFormOpen}
            table={editing}
          />

          <ConfirmDialog
            open={!!deleting}
            onOpenChange={(o) => !o && setDeleting(null)}
            title="Remove table?"
            description={`"${deleting?.tableNo}" will be removed from the floor plan. Past orders keep this table's name and are not affected — free the table first if it's occupied or reserved.`}
            confirmLabel="Remove"
            isLoading={deleteTable.isPending}
            onConfirm={confirmDelete}
          />
        </>
      )}
    </div>
  );
}
