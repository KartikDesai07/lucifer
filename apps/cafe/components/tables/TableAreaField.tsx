"use client";

import { useRef } from "react";

import { FormField } from "@/components/shared/FormField";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TABLE_AREA_NAME_MAX_LEN } from "@/lib/constants";
import { NEW_AREA_CHOICE, NO_AREA_CHOICE } from "@/lib/table-areas";
import type { Area } from "@/types";

const SELECT_ID = "table-area";
const NEW_NAME_ID = "table-area-new";

interface TableAreaFieldProps {
  /** undefined while the list has not loaded. */
  areas: readonly Area[] | undefined;
  choice: string;
  onChoiceChange: (choice: string) => void;
  newName: string;
  onNewNameChange: (name: string) => void;
  error?: string;
  disabled?: boolean;
}

// The table form's "Area" picker: No area, the areas in their arranged order, and
// "+ New area…" which reveals a name box (the area is created when the table is
// saved). The choice lives in the parent's state, not in react-hook-form.
export function TableAreaField({
  areas,
  choice,
  onChoiceChange,
  newName,
  onNewNameChange,
  error,
  disabled,
}: TableAreaFieldProps) {
  const nameRef = useRef<HTMLInputElement>(null);
  // Set when "+ New area…" is picked; read once when the list closes.
  const focusNameRef = useRef(false);

  const loading = areas === undefined;
  // A saved area that no longer exists has no matching item: show the placeholder
  // instead of a blank box (the form asks for another pick on save).
  const known =
    choice === NO_AREA_CHOICE ||
    choice === NEW_AREA_CHOICE ||
    (areas !== undefined && areas.some((a) => a._id === choice));

  const handleChange = (next: string) => {
    focusNameRef.current = next === NEW_AREA_CHOICE;
    onChoiceChange(next);
  };

  return (
    <FormField label="Area" htmlFor={SELECT_ID} error={error}>
      <Select value={known ? choice : ""} onValueChange={handleChange} disabled={loading || disabled}>
        <SelectTrigger id={SELECT_ID} aria-invalid={!!error}>
          {loading ? <SelectValue>Loading areas…</SelectValue> : <SelectValue placeholder="Pick an area" />}
        </SelectTrigger>
        <SelectContent
          // Radix hands focus back to the trigger when the list closes; picking
          // "+ New area…" sends it to the name box instead.
          onCloseAutoFocus={(event) => {
            if (!focusNameRef.current) return;
            focusNameRef.current = false;
            event.preventDefault();
            nameRef.current?.focus();
          }}
        >
          <SelectItem value={NO_AREA_CHOICE}>No area</SelectItem>
          {(areas ?? []).map((a) => (
            <SelectItem key={a._id} value={a._id}>
              {a.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW_AREA_CHOICE} className="font-medium text-primary">
            + New area…
          </SelectItem>
        </SelectContent>
      </Select>
      {choice === NEW_AREA_CHOICE && (
        <Input
          ref={nameRef}
          id={NEW_NAME_ID}
          aria-label="New area name"
          placeholder="e.g. Garden"
          maxLength={TABLE_AREA_NAME_MAX_LEN}
          value={newName}
          disabled={disabled}
          aria-invalid={!!error}
          onChange={(e) => onNewNameChange(e.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">Tables are grouped by area on the floor and in New Order.</p>
    </FormField>
  );
}
