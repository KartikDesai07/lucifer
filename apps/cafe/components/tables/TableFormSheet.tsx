"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createTableSchema } from "@/schemas";
import { useCreateTable, usePatchTable } from "@/hooks/use-tables";
import { Input } from "@/components/ui/input";
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import type { PatchTableInput } from "@/schemas";
import type { Table } from "@/types";

// createTableSchema is the stricter shape (tableNo required); reused for edit
// mode too — only the changed fields are actually sent via patch on submit.
type TableFormValues = z.infer<typeof createTableSchema>;

// Matches the Table model's own default (models/Table.ts) so an untouched
// "Seats" field on create doesn't send a spurious value.
const DEFAULT_CAPACITY = 4;

const emptyValues: TableFormValues = { tableNo: "", capacity: DEFAULT_CAPACITY };

interface TableFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: Table | null; // null → create
}

export function TableFormSheet({
  open,
  onOpenChange,
  table,
}: TableFormSheetProps) {
  const createTable = useCreateTable();
  const patchTable = usePatchTable();
  const isEdit = !!table;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<TableFormValues>({
    resolver: zodResolver(createTableSchema),
    defaultValues: emptyValues,
  });

  useEffect(() => {
    if (!open) return;
    reset(
      table
        ? { tableNo: table.tableNo, capacity: table.capacity }
        : emptyValues,
    );
  }, [open, table, reset]);

  const onSubmit = async (values: TableFormValues) => {
    try {
      if (isEdit) {
        // A rename never rewrites historical orders — only send the fields
        // that actually changed, not the full stricter-shape values object.
        const data: PatchTableInput = {};
        if (values.tableNo !== table.tableNo) data.tableNo = values.tableNo;
        if (values.capacity !== table.capacity) data.capacity = values.capacity;
        if (Object.keys(data).length > 0) {
          await patchTable.mutateAsync({ tableNo: table.tableNo, data });
        }
      } else {
        await createTable.mutateAsync(values);
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error
    }
  };

  const saving = createTable.isPending || patchTable.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit table" : "Add table"}
      description={
        isEdit
          ? "Rename or re-seat this table."
          : "Add a table to the floor plan."
      }
      submitLabel={isEdit ? "Save changes" : "Add table"}
      saving={saving}
      onSubmit={handleSubmit(onSubmit)}
    >
      <FormField
        label="Table name"
        htmlFor="table-no"
        error={errors.tableNo?.message}
      >
        <Input
          id="table-no"
          autoFocus
          placeholder="e.g. T-9 or Patio 1"
          aria-invalid={!!errors.tableNo}
          {...register("tableNo")}
        />
        <p className="text-xs text-muted-foreground">
          Letters, numbers, spaces and hyphens only.
        </p>
      </FormField>

      <FormField label="Seats" htmlFor="table-capacity" error={errors.capacity?.message}>
        <Input
          id="table-capacity"
          type="number"
          min={1}
          aria-invalid={!!errors.capacity}
          {...register("capacity", { valueAsNumber: true })}
        />
      </FormField>
    </FormSheet>
  );
}
