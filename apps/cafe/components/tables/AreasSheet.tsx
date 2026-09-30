"use client";

import { useRef, useState, type FormEvent } from "react";
import { Layers, Loader2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { AreaArrangeList } from "@/components/tables/AreaArrangeList";
import { AREA_RENAME_SELECTOR } from "@/components/tables/AreaRow";
import { useAreas, useCreateArea, useDeleteArea } from "@/hooks/use-areas";
import { TABLE_AREAS_MAX } from "@/lib/constants";
import { areaInUseMessage, tablesInArea } from "@/lib/table-areas";
import { areaNameSchema } from "@/schemas";
import type { Area, Table } from "@/types";

const SKELETON_ROWS = 3;
const NEW_AREA_INPUT_ID = "new-area-name";
// dnd-kit sets aria-pressed="true" on the draggable that is mid-drag.
const ACTIVE_DRAG_SELECTOR = '[aria-pressed="true"]';

interface AreasSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tables: Table[];
}

interface AreaAddFormProps {
  ready: boolean; // the list has loaded, so the limit can be judged
  count: number;
}

// The "New area" row. Mounted inside the sheet content, so closing the sheet
// clears the typed name and any error with it.
function AreaAddForm({ ready, count }: AreaAddFormProps) {
  const create = useCreateArea();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const atMax = ready && count >= TABLE_AREAS_MAX;
  const disabled = !ready || atMax;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (disabled || create.isPending) return;
    const parsed = areaNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    try {
      await create.mutateAsync({ name: parsed.data });
      setName("");
      setError(null);
      // The Add button disables itself once the name clears; keep the keyboard
      // where it was so the next area can be typed straight away.
      nameInput.current?.focus();
    } catch {
      // The hook toasts the server's reason (a duplicate name, for one); the
      // typed name stays so it can be corrected.
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-2">
      <Label htmlFor={NEW_AREA_INPUT_ID}>New area</Label>
      <div className="flex gap-2">
        <Input
          ref={nameInput}
          id={NEW_AREA_INPUT_ID}
          placeholder="e.g. Garden"
          value={name}
          disabled={disabled}
          aria-invalid={error !== null}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          className="h-11 md:h-10"
        />
        <Button type="submit" disabled={disabled || create.isPending || name.trim() === ""} className="h-11 shrink-0 md:h-10">
          {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Add area
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {atMax && (
        <p className="text-sm text-muted-foreground">
          You have reached the limit of {TABLE_AREAS_MAX} areas. Delete one to add another.
        </p>
      )}
    </form>
  );
}

// The Areas manager (admin, opened from Setup): create the names once, set
// their order, rename or delete. Tables pick from this list in Edit table.
export function AreasSheet({ open, onOpenChange, tables }: AreasSheetProps) {
  const areas = useAreas();
  const remove = useDeleteArea();
  const [target, setTarget] = useState<Area | null>(null);

  // The dialog copy keeps the last area while it fades out: `target` turns null
  // the moment a dialog closes, which would otherwise flash empty copy during
  // the exit animation.
  const [shown, setShown] = useState<Area | null>(target);
  if (target && target !== shown) setShown(target);
  const subject = target ?? shown;
  const subjectName = subject?.name ?? "";
  // The count comes from the tables this screen holds; the server's 409 (same
  // copy, areaInUseMessage) stays the fence for a stale view.
  const inUseCount = subject ? tablesInArea(tables, subject._id).length : 0;

  const list = areas.data;

  const handleSheetOpenChange = (next: boolean) => {
    if (!next) setTarget(null);
    onOpenChange(next);
  };

  const confirmDelete = async () => {
    if (!target) return;
    try {
      await remove.mutateAsync(target._id);
      setTarget(null);
    } catch {
      // The hook toasts the reason; keep the dialog so the admin can retry or cancel.
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={handleSheetOpenChange}>
        <SheetContent
          className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md"
          // Escape while renaming cancels the rename (the row handles it), not the
          // sheet. Escape during a keyboard drag cancels the drag: dnd-kit marks
          // the grip it is moving aria-pressed, so the sheet stays open then too.
          onEscapeKeyDown={(e) => {
            if (e.target instanceof Element && e.target.closest(AREA_RENAME_SELECTOR)) e.preventDefault();
            if (e.target instanceof Element && e.target.closest(ACTIVE_DRAG_SELECTOR)) e.preventDefault();
          }}
        >
          <SheetHeader>
            <SheetTitle>Areas</SheetTitle>
            <SheetDescription>
              Group tables by where they are, for example AC Hall, Garden or Rooftop. The floor, New Order and Move
              table show tables under these headings.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-4 p-4">
            <AreaAddForm ready={list !== undefined} count={list?.length ?? 0} />

            {list === undefined ? (
              areas.isError ? (
                <ErrorState
                  title="Couldn't load the areas"
                  description="Check the internet connection, then try again."
                  retryLabel="Try again"
                  onRetry={() => void areas.refetch()}
                />
              ) : (
                <div className="space-y-2 rounded-lg border p-4">
                  {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              )
            ) : list.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-8 w-8" />}
                title="No areas yet"
                description="Add an area above, then pick it for each table in Edit table."
              />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Drag the handle, or use the up and down arrows. The floor shows areas in this order.
                </p>
                <AreaArrangeList areas={list} tables={tables} onDelete={setTarget} />
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={target !== null && inUseCount === 0}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
        title="Delete area?"
        description={`"${subjectName}" will be removed. No table uses it.`}
        confirmLabel="Delete"
        isLoading={remove.isPending}
        onConfirm={confirmDelete}
      />

      {/* An area that tables still use cannot be deleted: information only, no delete action. */}
      <AlertDialog
        open={target !== null && inUseCount > 0}
        onOpenChange={(next) => {
          if (!next) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>This area is in use</AlertDialogTitle>
            <AlertDialogDescription>
              {areaInUseMessage(inUseCount)} Use Edit table on each one to pick another area.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
