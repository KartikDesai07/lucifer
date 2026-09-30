import { Armchair, Check, Pencil, Trash2, X } from "lucide-react";

import { formatDate, formatTime, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BRAND_PANEL_CLASS, BRAND_ROW_ACTION_CLASS, BRAND_TABLE_CONTAIN_CLASS } from "@/components/brand/brand-classes";
import { STATUS_VARIANTS } from "@/components/reservations/ReservationRowCard";
import type { Reservation } from "@/types";

interface ReservationsTableProps {
  list: Reservation[];
  busy: boolean;
  onSeat: (r: Reservation) => void;
  onComplete: (r: Reservation) => void;
  onCancel: (r: Reservation) => void;
  onEdit: (r: Reservation) => void;
  onDelete: (r: Reservation) => void;
}

/** Desktop table (lg and up) — same handlers and conditions as ReservationRowCard. */
export function ReservationsTable({
  list,
  busy,
  onSeat,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
}: ReservationsTableProps) {
  return (
    <div className={cn("hidden rounded-lg border lg:block", BRAND_PANEL_CLASS, BRAND_TABLE_CONTAIN_CLASS)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Guest</TableHead>
            <TableHead className="text-right">Guests</TableHead>
            <TableHead>Table</TableHead>
            <TableHead>Status</TableHead>
            {/* 5 buttons x 40px + 4 gaps x 4px = 216px, plus the cell padding. */}
            <TableHead className="w-60 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((r) => (
            <TableRow key={r._id}>
              <TableCell>
                <div className="font-medium">{formatDate(r.date)}</div>
                <div className="text-xs text-muted-foreground">{formatTime(r.time)}</div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{r.name}</div>
                <div className="text-xs text-muted-foreground">{r.mobile}</div>
              </TableCell>
              <TableCell className="text-right">{r.guests}</TableCell>
              <TableCell className="text-muted-foreground">{r.tableNo ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={cn(STATUS_VARIANTS[r.status])}>
                  {r.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  {r.status === "Booked" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={BRAND_ROW_ACTION_CLASS}
                      disabled={busy}
                      onClick={() => onSeat(r)}
                      aria-label="Seat guest"
                      title="Seat"
                    >
                      <Armchair className="h-4 w-4" />
                    </Button>
                  )}
                  {r.status === "Seated" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={BRAND_ROW_ACTION_CLASS}
                      disabled={busy}
                      onClick={() => onComplete(r)}
                      aria-label="Complete reservation"
                      title="Complete"
                    >
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                  )}
                  {(r.status === "Booked" || r.status === "Seated") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className={BRAND_ROW_ACTION_CLASS}
                      disabled={busy}
                      onClick={() => onCancel(r)}
                      aria-label="Cancel reservation"
                      title="Cancel"
                    >
                      <X className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className={BRAND_ROW_ACTION_CLASS}
                    onClick={() => onEdit(r)}
                    aria-label="Edit reservation"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={BRAND_ROW_ACTION_CLASS}
                    onClick={() => onDelete(r)}
                    aria-label="Delete reservation"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
