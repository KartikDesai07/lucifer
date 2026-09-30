"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createTableSchema } from "@/schemas";
import { TABLE_CHARGE_MAX, TABLE_CHARGE_LABEL_MAX_LEN } from "@/lib/constants";
import { useAreas, useCreateArea } from "@/hooks/use-areas";
import { useCreateTable, usePatchTable } from "@/hooks/use-tables";
import {
  NO_AREA_CHOICE,
  areaPatchOf,
  initialAreaChoice,
  resolveAreaChoice,
  type CreatedArea,
} from "@/lib/table-areas";
import { Input } from "@/components/ui/input";
import { FormSheet } from "@/components/shared/FormSheet";
import { FormField } from "@/components/shared/FormField";
import { TableAreaField } from "@/components/tables/TableAreaField";
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
  const createArea = useCreateArea();
  const areasQuery = useAreas();
  const isEdit = !!table;

  // The area picker lives outside react-hook-form: its value is an area id, the
  // "new area" sentinel or the no-area sentinel, and it may need creating first.
  const [choice, setChoice] = useState(NO_AREA_CHOICE);
  const [newName, setNewName] = useState("");
  const [areaError, setAreaError] = useState<string | undefined>(undefined);
  // An area this form already created: a retry after a failed table save must
  // reuse it, never create it a second time.
  const [createdArea, setCreatedArea] = useState<CreatedArea | undefined>(undefined);

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
    // The area picker resets with the rest of the form on every open.
    setChoice(initialAreaChoice(table ?? undefined));
    setNewName("");
    setAreaError(undefined);
    setCreatedArea(undefined);
  }, [open, table, reset]);

  const onSubmit = async (values: TableFormValues) => {
    const resolved = resolveAreaChoice(choice, newName, areasQuery.data, createdArea);
    if (resolved.kind === "invalid") {
      setAreaError(resolved.message);
      return;
    }
    setAreaError(undefined);
    try {
      let nextAreaId: string | null = resolved.kind === "existing" ? resolved.id : null;
      if (resolved.kind === "create") {
        const created = await createArea.mutateAsync({ name: resolved.name });
        setCreatedArea({ id: created._id, name: created.name });
        setChoice(created._id);
        nextAreaId = created._id;
      }
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
        // Area: nothing when unchanged, {areaId: null} to clear, {areaId: id} to move.
        const payload: PatchTableInput = { ...data, ...areaPatchOf(initialAreaChoice(table), nextAreaId) };
        if (Object.keys(payload).length > 0) {
          await patchTable.mutateAsync({ tableNo: table.tableNo, data: payload });
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
          ...(nextAreaId ? { areaId: nextAreaId } : {}),
        });
      }
      onOpenChange(false);
    } catch {
      // hooks toast on error
    }
  };

  const saving = createArea.isPending || createTable.isPending || patchTable.isPending;

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit table" : "Add table"}
      description={
        isEdit
          ? "Change this table's name, seats, area or charge."
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

      <TableAreaField
        areas={areasQuery.data}
        choice={choice}
        onChoiceChange={(next) => {
          setChoice(next);
          setAreaError(undefined);
        }}
        newName={newName}
        onNewNameChange={(name) => {
          setNewName(name);
          setAreaError(undefined);
        }}
        error={areaError}
        disabled={saving}
      />

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
