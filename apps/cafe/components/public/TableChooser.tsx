"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api-client";
import { cn } from "@/lib/utils";

// GET /api/public/tables — names only, never a token/status/charge/_id (the
// route is owned by the main thread, ADDENDUM 1). Table names are printed on
// the furniture and visible to anyone in the room, so they carry no secret
// the way a `publicToken` does.
interface PublicTable {
  tableNo: string;
}

// CR2.2 FIX6 — a discriminated pick, not a raw string: a real table literally
// named "parcel" (an operator can type anything into tableNo) must never be
// able to masquerade as the Parcel pill by sentinel string collision. "parcel"
// is a `kind`, never a value compared against a table's own name — a table
// named "parcel" lands in the `tableName` branch exactly like any other name.
export type TablePick = { kind: "parcel" } | { kind: "tableName"; name: string };

interface TableChooserProps {
  value: TablePick | null;
  onSelect: (pick: TablePick) => void;
  // SLICE 8/D4: when the operator has turned OFF the diner-pickable-table
  // toggle (Settings.allowTableChange), an unscanned table claim is disabled
  // entirely — the chooser collapses to Parcel-only and never fetches or
  // shows the table-name list at all.
  parcelOnly?: boolean;
}

// D4 (ADDENDUM 1, overriding SLICE 4's original text): a diner on the bare
// /m route can pick a table by NAME off a plain list, or Parcel. This pick is
// advisory only — it just relabels the menu the diner is looking at, and
// CR2.1 writes nothing anywhere. A scanned QR (the /m/<token> route) resolves
// a real `publicToken` and stays the authoritative identity; CR2.2's order
// request is what will tell staff which kind of pick they're looking at.
export function TableChooser({ value, onSelect, parcelOnly }: TableChooserProps) {
  const [tables, setTables] = useState<PublicTable[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (parcelOnly) return;
    let active = true;
    apiGet<PublicTable[]>("/api/public/tables")
      .then((data) => {
        if (active) setTables(data);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [parcelOnly]);

  if (parcelOnly) {
    return (
      <div className="rounded-lg border p-3">
        <p className="mb-2 text-sm font-medium">
          Table pick is turned off — choose Parcel to continue.
        </p>
        <TablePill
          label="Parcel"
          active={value?.kind === "parcel"}
          onClick={() => onSelect({ kind: "parcel" })}
        />
      </div>
    );
  }

  if (failed) {
    return (
      <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
        Couldn&apos;t load the table list — ask a staff member which table
        you&apos;re at, or scan the QR code on your table.
      </p>
    );
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-sm font-medium">Which table are you at?</p>
      <div className="flex flex-wrap gap-2">
        {tables === null ? (
          <span className="text-sm text-muted-foreground">Loading tables…</span>
        ) : tables.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No tables set up yet — ask staff, or choose Parcel.
          </span>
        ) : (
          tables.map((t) => (
            <TablePill
              key={t.tableNo}
              label={t.tableNo}
              active={value?.kind === "tableName" && value.name === t.tableNo}
              onClick={() => onSelect({ kind: "tableName", name: t.tableNo })}
            />
          ))
        )}
        <TablePill
          label="Parcel"
          active={value?.kind === "parcel"}
          onClick={() => onSelect({ kind: "parcel" })}
        />
      </div>
      {/* A picked table is a best guess, not a scan — say so once, plainly. */}
      <p className="mt-2 text-xs text-muted-foreground">
        Picking a table here is just a guess for now — scanning the QR code
        printed on your table is the sure way.
      </p>
    </div>
  );
}

function TablePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
