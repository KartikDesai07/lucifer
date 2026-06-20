import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Trash2, Pencil, CalendarClock } from "lucide-react";
import { useReservations, type Reservation, uid } from "@/lib/storage";
import { toast } from "sonner";

export const Route = createFileRoute("/reservations")({
  head: () => ({
    meta: [
      { title: "Table Reservations — Lucifer Cafe" },
      { name: "description", content: "Automated table reservations for the café." },
    ],
  }),
  component: ReservationsPage,
});

const STATUSES: Reservation["status"][] = ["Booked", "Seated", "Completed", "Cancelled"];

function ReservationsPage() {
  const [list, setList] = useReservations();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Reservation | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const sorted = useMemo(
    () =>
      [...list]
        .filter((r) => filter === "all" || r.status === filter)
        .filter(
          (r) =>
            r.name.toLowerCase().includes(q.toLowerCase()) ||
            r.mobile.includes(q) ||
            r.date.includes(q)
        )
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    [list, q, filter]
  );

  const startNew = () => {
    const now = new Date();
    setEditing({
      id: "", name: "", mobile: "",
      date: now.toISOString().slice(0, 10),
      time: "19:00", guests: 2, tableNo: "", notes: "", status: "Booked",
    });
    setOpen(true);
  };

  const save = () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.mobile.trim() || !editing.date || !editing.time)
      return toast.error("Name, mobile, date and time are required");
    setList((prev) => {
      if (editing.id) return prev.map((r) => (r.id === editing.id ? editing : r));
      return [...prev, { ...editing, id: uid() }];
    });
    toast.success("Reservation saved");
    setOpen(false);
  };

  const setStatus = (id: string, status: Reservation["status"]) =>
    setList((p) => p.map((r) => (r.id === id ? { ...r, status } : r)));

  const remove = (id: string) => setList((p) => p.filter((r) => r.id !== id));

  return (
    <div className="space-y-4 max-w-6xl">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, mobile or date" className="pl-9" />
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}><Plus className="h-4 w-4" /> New Reservation</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "New"} Reservation</DialogTitle></DialogHeader>
            {editing && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                  <div><Label>Mobile</Label><Input value={editing.mobile} onChange={(e) => setEditing({ ...editing, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Date</Label><Input type="date" value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} /></div>
                  <div><Label>Time</Label><Input type="time" value={editing.time} onChange={(e) => setEditing({ ...editing, time: e.target.value })} /></div>
                  <div><Label>Guests</Label><Input type="number" min={1} value={editing.guests} onChange={(e) => setEditing({ ...editing, guests: Number(e.target.value) })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Table No.</Label><Input value={editing.tableNo || ""} onChange={(e) => setEditing({ ...editing, tableNo: e.target.value })} placeholder="e.g. T4" /></div>
                  <div>
                    <Label>Status</Label>
                    <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as Reservation["status"] })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Notes</Label><Textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} placeholder="Birthday, allergies, seating preference..." /></div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">When</th>
                <th className="text-left p-3">Guest</th>
                <th className="text-left p-3">Mobile</th>
                <th className="text-right p-3">Pax</th>
                <th className="text-left p-3">Table</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Notes</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="h-4 w-4 text-primary" />
                      <div>
                        <div className="font-medium">{r.date}</div>
                        <div className="text-xs text-muted-foreground">{r.time}</div>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 font-medium">{r.name}</td>
                  <td className="p-3 text-muted-foreground">{r.mobile}</td>
                  <td className="p-3 text-right">{r.guests}</td>
                  <td className="p-3">{r.tableNo || "—"}</td>
                  <td className="p-3">
                    <Select value={r.status} onValueChange={(v) => setStatus(r.id, v as Reservation["status"])}>
                      <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">{r.notes}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={8} className="p-10 text-center text-muted-foreground">No reservations yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
