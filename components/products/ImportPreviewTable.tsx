"use client";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ImportRowResult } from "@/types";
import type { ImportRowStatus } from "@/lib/product-import";

const STATUS_STYLES: Record<
  ImportRowStatus,
  { label: string; className: string }
> = {
  create: {
    label: "New",
    className: "border-transparent bg-green-100 text-green-700",
  },
  update: {
    label: "Update",
    className: "border-transparent bg-blue-100 text-blue-700",
  },
  duplicate: {
    label: "Duplicate",
    className: "border-transparent bg-amber-100 text-amber-700",
  },
  error: {
    label: "Error",
    className: "border-transparent bg-red-100 text-red-700",
  },
};

// Scrollable per-row verdict table for the import dry-run preview.
export function ImportPreviewTable({ rows }: { rows: ImportRowResult[] }) {
  return (
    <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
      <Table>
        <TableHeader className="sticky top-0 bg-background">
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="w-24">Status</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const style = STATUS_STYLES[r.status];
            return (
              <TableRow key={r.row}>
                <TableCell className="text-muted-foreground">{r.row}</TableCell>
                <TableCell className="font-medium">
                  {r.name || (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.category || "—"}
                </TableCell>
                <TableCell>
                  <Badge className={cn("text-[10px]", style.className)}>
                    {style.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.status === "error" ? (
                    <span className="text-destructive">
                      {r.errors?.join("; ")}
                    </span>
                  ) : r.status === "duplicate" ? (
                    "Superseded by a later row with the same name"
                  ) : (
                    ""
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
