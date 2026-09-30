import { Check, Pencil, Trash2, Wallet, X } from "lucide-react";

import { formatDate, formatTime, inr, cn } from "@/lib/utils";
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
import { STATUS_VARIANTS } from "@/components/events/EventRowCard";
import type { Event } from "@/types";

interface EventsTableProps {
  list: Event[];
  busy: boolean;
  onReceiveBalance: (e: Event) => void;
  onComplete: (e: Event) => void;
  onCancel: (e: Event) => void;
  onEdit: (e: Event) => void;
  onDelete: (e: Event) => void;
}

/** Desktop table (lg and up) — same handlers and conditions as EventRowCard. */
export function EventsTable({
  list,
  busy,
  onReceiveBalance,
  onComplete,
  onCancel,
  onEdit,
  onDelete,
}: EventsTableProps) {
  return (
    <div className={cn("hidden rounded-lg border xl:block", BRAND_PANEL_CLASS, BRAND_TABLE_CONTAIN_CLASS)}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Event</TableHead>
            <TableHead>When</TableHead>
            <TableHead>Customer</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead>Status</TableHead>
            {/* 5 buttons x 40px + 4 gaps x 4px = 216px, plus the cell padding. */}
            <TableHead className="w-60 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((e) => {
            const balance = Math.max(0, e.payable - e.advance);
            return (
              <TableRow key={e._id}>
                <TableCell className="font-medium">{e.eventName}</TableCell>
                <TableCell>
                  <div>{formatDate(e.date)}</div>
                  <div className="text-xs text-muted-foreground">{formatTime(e.time)}</div>
                </TableCell>
                <TableCell>
                  <div>{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.mobile}</div>
                </TableCell>
                <TableCell className="text-right">{inr(e.payable)}</TableCell>
                <TableCell className="text-right">
                  {balance > 0 ? (
                    <Badge variant="destructive">Due {inr(balance)}</Badge>
                  ) : (
                    <span className="text-green-700">Paid</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={cn(STATUS_VARIANTS[e.status])}>
                    {e.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    {balance > 0 && e.status === "Booked" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className={BRAND_ROW_ACTION_CLASS}
                        disabled={busy}
                        onClick={() => onReceiveBalance(e)}
                        aria-label="Receive balance"
                        title="Receive balance"
                      >
                        <Wallet className="h-4 w-4 text-green-600" />
                      </Button>
                    )}
                    {e.status === "Booked" && (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={BRAND_ROW_ACTION_CLASS}
                          disabled={busy}
                          onClick={() => onComplete(e)}
                          aria-label="Complete event"
                          title="Complete"
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={BRAND_ROW_ACTION_CLASS}
                          disabled={busy}
                          onClick={() => onCancel(e)}
                          aria-label="Cancel event"
                          title="Cancel"
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={BRAND_ROW_ACTION_CLASS}
                      onClick={() => onEdit(e)}
                      aria-label="Edit event"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={BRAND_ROW_ACTION_CLASS}
                      onClick={() => onDelete(e)}
                      aria-label="Delete event"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
