"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createTableSchema } from "@/schemas";
import { TABLE_CHARGE_MAX, TABLE_CHARGE_LABEL_MAX_LEN } from "@/lib/constants";
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

// A blank charge field means "this table has no charge", not "zero" and not
// NaN — react-hook-form's valueAsNumber would hand the schema a NaN, whose
// error ("expected number") tells the operator nothing they can act on.
const blankToUndefinedNumber = (v: unknown): number | undefined =>
  v === "" || v === null || v === undefined ? undefined : Number(v);

const blankToUndefinedText = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() === "" ? undefined : (v as string | undefined);

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
        ? {
            tableNo: table.tableNo,
            capacity: table.capacity,
            chargeAmount: table.chargeAmount,
            chargeLabel: table.chargeLabel,
          }
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
        // The charge's two halves move TOGETHER: the schema requires a priced
        // charge to carry its name in the same payload (a partial patch cannot
        // see the stored one), and clearing the amount has to take the name
        // with it or the table keeps a name for a charge it no longer makes.
        const nextAmount = values.chargeAmount ?? 0;
        const nextLabel = values.chargeLabel ?? "";
        if (
          nextAmount !== (table.chargeAmount ?? 0) ||
          nextLabel !== (table.chargeLabel ?? "")
        ) {
          data.chargeAmount = nextAmount;
          data.chargeLabel = nextAmount > 0 ? nextLabel : "";
        }
        if (Object.keys(data).length > 0) {
          await patchTable.mutateAsync({ tableNo: table.tableNo, data });
        }
      } else {
        // Same pairing rule on create: a table with no charge is stored with
        // neither field rather than with a named zero.
        const charged = (values.chargeAmount ?? 0) > 0;
        await createTable.mutateAsync({
          tableNo: values.tableNo,
          capacity: values.capacity,
          ...(charged
            ? { chargeAmount: values.chargeAmount, chargeLabel: values.chargeLabel }
            : {}),
        });
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

      <FormField
        label="Extra charge (optional)"
        htmlFor="table-charge-amount"
        error={errors.chargeAmount?.message}
      >
        <Input
          id="table-charge-amount"
          type="number"
          min={0}
          max={TABLE_CHARGE_MAX}
          placeholder="0"
          aria-invalid={!!errors.chargeAmount}
          // valueAsNumber turns an empty field into NaN, which the schema then
          // rejects with a type error the operator cannot act on. Blank means
          // "no charge", so map it to undefined instead.
          {...register("chargeAmount", { setValueAs: blankToUndefinedNumber })}
        />
        <p className="text-xs text-muted-foreground">
          Added to every bill on this table, on top of GST. Leave blank for none.
        </p>
      </FormField>

      <FormField
        label="Charge name"
        htmlFor="table-charge-label"
        error={errors.chargeLabel?.message}
      >
        <Input
          id="table-charge-label"
          placeholder="e.g. Rooftop charge"
          maxLength={TABLE_CHARGE_LABEL_MAX_LEN}
          aria-invalid={!!errors.chargeLabel}
          {...register("chargeLabel", { setValueAs: blankToUndefinedText })}
        />
        <p className="text-xs text-muted-foreground">
          Printed on the customer&apos;s bill exactly as typed.
        </p>
      </FormField>
    </FormSheet>
  );
}
